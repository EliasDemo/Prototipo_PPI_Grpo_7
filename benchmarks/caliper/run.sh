#!/bin/bash
# F9.4 Ejecuta la matriz. Cada corrida: reinicia el laboratorio, comprueba la red, levanta la API con su estrategia,
# corre Caliper, concilia hasta 90 s y exporta a artifacts/results/<corrida>/.
# Uso: pnpm bench              (matriz de config/matriz.env)
#      pnpm bench --piloto     (F9.6: una combinación por estrategia)
# Variables: cualquiera de matriz.env, SIN_HEALTH=1 (red sin Docker), BENCH_PUERTO, ETIQUETA.
set -euo pipefail
BENCH="$(cd "$(dirname "$0")" && pwd)"
source "$BENCH/../../scripts/data/_mysql.sh"
cd "$RAIZ"
DEF=$(declare -p ESTRATEGIAS TASAS CARGAS REPETICIONES WORKERS CALENTAMIENTO_S OBSERVACION_S MUESTRA 2>/dev/null || true)
source "$BENCH/config/matriz.env"
eval "$DEF"
PUERTO="${BENCH_PUERTO:-3100}"
export BENCH_BASE_URL="http://127.0.0.1:$PUERTO"
SEMILLA="${EXPERIMENT_SEED:-20261027}"
ETIQUETA="${ETIQUETA:-matriz}"
if [[ "${1:-}" == "--piloto" ]]; then
  ETIQUETA=piloto; TASAS="${TASAS%% *}"; CARGAS="${CARGAS%% *}"; REPETICIONES=1
fi
[[ -x "$BENCH/node_modules/.bin/caliper" ]] || (cd "$BENCH" && npm install --no-audit --no-fund --loglevel=error)
[[ -f .next/BUILD_ID ]] || pnpm -s build

COMMIT=$(git rev-parse HEAD)
[[ -z "$(git status --porcelain)" ]] || echo "AVISO: hay cambios sin commit; la corrida no será trazable a $COMMIT" >&2
CONFIG=$(printf '{"etiqueta":"%s","estrategias":"%s","tasas":"%s","cargas":"%s","repeticiones":%s,"workers":%s,"calentamiento_s":%s,"observacion_s":%s,"muestra":%s,"semilla":%s}' \
  "$ETIQUETA" "$ESTRATEGIAS" "$TASAS" "$CARGAS" "$REPETICIONES" "$WORKERS" "$CALENTAMIENTO_S" "$OBSERVACION_S" "$MUESTRA" "$SEMILLA")
HASH=$(printf '%s' "$CONFIG" | sha256sum | cut -d' ' -f1)
EXP=$(echo "SELECT experimento_id FROM experimento WHERE config_sha256='$HASH';" | mysql_prep -N "$MYSQL_DB_EXP" 2>/dev/null)
if [[ -z "$EXP" ]]; then
  EXP=$(cat /proc/sys/kernel/random/uuid)
  echo "INSERT INTO experimento (experimento_id,nombre,config,config_sha256) VALUES ('$EXP','$ETIQUETA','$CONFIG','$HASH');" | mysql_prep "$MYSQL_DB_EXP" 2>/dev/null
fi

SERVIDOR=""; MUESTREO=()
limpiar() {
  for p in "${MUESTREO[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done
  MUESTREO=()
  [[ -n "$SERVIDOR" ]] && kill -- "-$SERVIDOR" 2>/dev/null || true
  SERVIDOR=""
}
trap limpiar EXIT

tamanos() { # momento dir: tamaño de la base experimental y del ledger (F9.5)
  local base ledger
  base=$(echo "SELECT COALESCE(SUM(data_length+index_length),0) FROM information_schema.tables WHERE table_schema='$MYSQL_DB_EXP';" | mysql_prep -N 2>/dev/null)
  ledger=$(docker exec peer0.org1.example.com du -sb /var/hyperledger/production/ledgersData 2>/dev/null | cut -f1 || true)
  echo "$1,${base:-},${ledger:-}" >>"$2/tamanos.csv"
}

corrida() { # estrategia carga tasa repeticion
  local est="$1" carga="$2" tasa="$3" rep="$4" id dir
  id=$(cat /proc/sys/kernel/random/uuid)
  dir="artifacts/results/$ETIQUETA-$est-$carga-$tasa-r$rep"
  rm -rf "$dir"; mkdir -p "$dir"
  echo "== $est $carga $tasa op/s, repetición $rep"

  bash scripts/data/reset-experimental.sh --si >/dev/null 2>&1
  [[ "$est" == BD || -n "${SIN_HEALTH:-}" ]] || bash infra/fabric/network/health.sh >/dev/null
  echo "DELETE FROM corrida WHERE experimento_id='$EXP' AND estrategia='$est' AND carga='$carga' AND tps_ofrecido=$tasa AND workers=$WORKERS AND repeticion=$rep;
        INSERT INTO corrida (corrida_id,experimento_id,estrategia,carga,tps_ofrecido,workers,repeticion,semilla,git_commit,estado,inicio)
        VALUES ('$id','$EXP','$est','$carga',$tasa,$WORKERS,$rep,$SEMILLA,'$COMMIT','EN_CURSO',NOW(3));" | mysql_prep "$MYSQL_DB_EXP" 2>/dev/null

  EXPERIMENT_STRATEGY="$est" LEDGER=fabric setsid pnpm exec next start -p "$PUERTO" >"$dir/api.log" 2>&1 &
  SERVIDOR=$!
  for _ in $(seq 1 60); do curl -sf -o /dev/null -X DELETE "$BENCH_BASE_URL/api/v1/autenticacion/sesion" && break; sleep 0.5; done

  # F9.5 Recursos y profundidad de la bandeja durante la corrida.
  ( echo "tomada_en,profundidad"; while sleep 5; do
      echo "$(date -Is),$(echo "SELECT COUNT(*) FROM operacion WHERE estado IN ('PENDIENTE','ENVIADA');" | mysql_prep -N "$MYSQL_DB_EXP" 2>/dev/null)"; done ) >"$dir/bandeja.csv" &
  MUESTREO+=($!)
  ( echo "tomada_en,contenedor,cpu,memoria"; while sleep 5; do
      docker stats --no-stream --format "$(date -Is),{{.Name}},{{.CPUPerc}},{{.MemUsage}}" 2>/dev/null || true; done ) >"$dir/recursos.csv" &
  MUESTREO+=($!)
  ( echo "tomada_en,cpu_pct,mem_mb,proceso"; while sleep 5; do
      ps -eo pcpu,rss,comm --no-headers | awk -v t="$(date -Is)" '$3 ~ /node|next/ {print t","$1","$2/1024","$3}'; done ) >"$dir/generador.csv" &
  MUESTREO+=($!)

  cat >"$dir/benchconfig.yaml" <<YAML
test:
  name: ppi
  workers: { number: $WORKERS }
  rounds:
    - label: calentamiento
      txDuration: $CALENTAMIENTO_S
      rateControl: { type: fixed-rate, opts: { tps: $tasa } }
      workload: { module: workloads/eventos.js, arguments: { carga: $carga, semilla: $SEMILLA, muestra: $MUESTRA, medir: false } }
    - label: observacion
      txDuration: $OBSERVACION_S
      rateControl: { type: fixed-rate, opts: { tps: $tasa } }
      workload: { module: workloads/eventos.js, arguments: { carga: $carga, semilla: $SEMILLA, muestra: $MUESTRA, medir: true } }
YAML
  local absdir="$RAIZ/$dir" estado=TERMINADA
  tamanos antes "$dir"
  (cd "$BENCH" && CORRIDA_ID="$id" BENCH_TOKEN="$BENCH_TOKEN" npx caliper launch manager \
      --caliper-workspace . --caliper-networkconfig config/red.yaml --caliper-benchconfig "$absdir/benchconfig.yaml" \
      --caliper-report-path "$absdir/caliper-report.html" --caliper-flow-skip-install >"$absdir/caliper.log" 2>&1) || estado=ABORTADA

  echo "UPDATE corrida SET estado='CONCILIANDO' WHERE corrida_id='$id';" | mysql_prep "$MYSQL_DB_EXP" 2>/dev/null
  local limite=$((SECONDS + 90))
  while (( SECONDS < limite )); do
    EXPERIMENT_STRATEGY="$est" LEDGER=fabric pnpm -s reconcile --antiguedad=0 >>"$dir/conciliacion.log" 2>&1 || true
    [[ "$(echo "SELECT COUNT(*) FROM operacion WHERE estado IN ('PENDIENTE','ENVIADA');" | mysql_prep -N "$MYSQL_DB_EXP" 2>/dev/null)" == 0 ]] && break
    sleep 5
  done

  tamanos despues "$dir"

  # Caliper termina con código 0 aunque fallen sus rondas: una corrida así no vale.
  grep -q "Failed rounds: 0" "$dir/caliper.log" || estado=ABORTADA
  [[ "$(echo "SELECT COUNT(*) FROM medicion WHERE corrida_id='$id';" | mysql_prep -N "$MYSQL_DB_EXP" 2>/dev/null)" != 0 ]] || estado=ABORTADA

  # F9.8 Solo tiempos y tamaños; sin identificadores de registros.
  curl -sf -H "authorization: Bearer $BENCH_TOKEN" "$BENCH_BASE_URL/api/v1/experimentos/mediciones?corrida=$id&formato=csv" >"$dir/mediciones.csv" || estado=ABORTADA
  limpiar
  echo "UPDATE corrida SET estado='$estado', fin=NOW(3) WHERE corrida_id='$id';" | mysql_prep "$MYSQL_DB_EXP" 2>/dev/null
  printf '{"corrida":"%s","estrategia":"%s","carga":"%s","tasa":%s,"repeticion":%s,"estado":"%s","git_commit":"%s","config_sha256":"%s","config":%s}\n' \
    "$id" "$est" "$carga" "$tasa" "$rep" "$estado" "$COMMIT" "$HASH" "$CONFIG" >"$dir/config.json"
  echo "   $estado: $dir"
}

read -r -a LISTA <<<"$ESTRATEGIAS"
for carga in $CARGAS; do for tasa in $TASAS; do
  for ((rep = 1; rep <= REPETICIONES; rep++)); do
    # ADR-017: el orden de las estrategias rota en cada repetición.
    n=${#LISTA[@]}
    for ((k = 0; k < n; k++)); do corrida "${LISTA[$(((k + rep - 1) % n))]}" "$carga" "$tasa" "$rep"; done
  done
done; done
