#!/usr/bin/env python3
"""F10.1 y F10.2. Resume artifacts/results: calcula cada métrica por corrida y luego la mediana entre repeticiones,
sin tratar cada transacción como un experimento independiente.
Uso: python3 scripts/experiments/analisis/analizar.py [--etiqueta matriz] [--salida artifacts/reports]"""
import argparse, csv, glob, json, os, statistics as st
from collections import defaultdict

def percentil(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, max(0, int(round(p / 100 * len(v) + 0.5)) - 1))] if v else None

def filas(ruta):
    with open(ruta, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def resumen_corrida(d, cfg):
    m = filas(f"{d}/mediciones.csv") if os.path.getsize(f"{d}/mediciones.csv") else []
    ok = [float(x["t_total_ms"]) for x in m if x["resultado"] == "CONFIRMADA"]
    bandeja = [int(x["profundidad"]) for x in filas(f"{d}/bandeja.csv") if x.get("profundidad", "").isdigit()] if os.path.exists(f"{d}/bandeja.csv") else []
    dur = cfg["config"]["observacion_s"]
    r = {
        "estrategia": cfg["estrategia"], "carga": cfg["carga"], "tasa": cfg["tasa"], "repeticion": cfg["repeticion"], "estado": cfg["estado"],
        "solicitudes": len(m), "confirmadas": len(ok),
        "exito_pct": 100 * len(ok) / len(m) if m else None, "confirmadas_s": len(ok) / dur,
        "media_ms": st.mean(ok) if ok else None, "p50_ms": percentil(ok, 50), "p95_ms": percentil(ok, 95),
        "bandeja_max": max(bandeja) if bandeja else None,
        "bytes_ledger": st.mean([float(x["bytes_onchain"]) for x in m if x["bytes_onchain"]] or [0]),
    }
    for res in ("FALLIDA", "TIMEOUT", "TARDIA", "RECHAZADA"):
        r[res.lower()] = sum(x["resultado"] == res for x in m)
    return r

METRICAS = ["exito_pct", "confirmadas_s", "media_ms", "p50_ms", "p95_ms", "bandeja_max", "bytes_ledger"]

def main():
    a = argparse.ArgumentParser()
    a.add_argument("--etiqueta", default="matriz")
    a.add_argument("--resultados", default="artifacts/results")
    a.add_argument("--salida", default="artifacts/reports")
    o = a.parse_args()
    corridas = []
    for c in sorted(glob.glob(f"{o.resultados}/{o.etiqueta}-*/config.json")):
        d = os.path.dirname(c)
        cfg = json.load(open(c, encoding="utf-8"))
        if os.path.exists(f"{d}/mediciones.csv"):
            corridas.append(resumen_corrida(d, cfg))
    if not corridas:
        raise SystemExit(f"No hay corridas con la etiqueta {o.etiqueta} en {o.resultados}")
    os.makedirs(o.salida, exist_ok=True)
    with open(f"{o.salida}/{o.etiqueta}-corridas.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(corridas[0])); w.writeheader(); w.writerows(corridas)

    grupos = defaultdict(list)
    for r in corridas:
        if r["estado"] == "TERMINADA":
            grupos[(r["carga"], r["estrategia"], r["tasa"])].append(r)
    esc = []
    for (carga, est, tasa), rs in sorted(grupos.items()):
        e = {"carga": carga, "estrategia": est, "tasa": tasa, "repeticiones": len(rs)}
        for m in METRICAS:
            v = [r[m] for r in rs if r[m] is not None]
            e[f"{m}_mediana"] = st.median(v) if v else None
            e[f"{m}_min"], e[f"{m}_max"] = (min(v), max(v)) if v else (None, None)
        esc.append(e)
    with open(f"{o.salida}/{o.etiqueta}-escenarios.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(esc[0]) if esc else ["sin_datos"]); w.writeheader(); w.writerows(esc)
    print(f"{len(corridas)} corridas, {len(esc)} escenarios terminados, en {o.salida}")

    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    except ImportError:
        print("Sin matplotlib: no se generan gráficos."); return
    for carga in {e["carga"] for e in esc}:
        for metrica, titulo, arch in (("p95_ms", "Latencia p95 (ms)", "latencia"), ("confirmadas_s", "Confirmadas por segundo", "throughput")):
            fig, ax = plt.subplots(figsize=(7, 4))
            for est in sorted({e["estrategia"] for e in esc}):
                s = sorted((e for e in esc if e["carga"] == carga and e["estrategia"] == est), key=lambda e: e["tasa"])
                s = [e for e in s if e[f"{metrica}_mediana"] is not None]
                if s:
                    y = [e[f"{metrica}_mediana"] for e in s]
                    ax.errorbar([e["tasa"] for e in s], y, marker="o", label=est,
                                yerr=[[v - e[f"{metrica}_min"] for v, e in zip(y, s)], [e[f"{metrica}_max"] - v for v, e in zip(y, s)]], capsize=3)
            ax.set(xlabel="Carga ofrecida (op/s)", ylabel=titulo, title=f"{carga}: mediana y rango entre repeticiones")
            ax.legend(); fig.tight_layout(); fig.savefig(f"{o.salida}/{o.etiqueta}-{arch}-{carga.lower()}.png", dpi=150); plt.close(fig)

if __name__ == "__main__":
    main()
