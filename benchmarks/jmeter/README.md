# Plan de JMeter (F9.7)

Mide la latencia de extremo a extremo de `POST /api/v1/eventos`, en corridas separadas de las de Caliper.

```bash
jmeter -n -t benchmarks/jmeter/eventos.jmx -Jtoken=$BENCH_TOKEN -Jtasa=5 -Jhilos=10 -Jduracion=240 \
  -Jids=ids.csv -l artifacts/results/jmeter-B-5/jmeter.jtl
```

`ids.csv` tiene una columna con un `origenId` de nota por línea y no entra al repositorio. Descarta los primeros 60 s al analizar. Una respuesta 202 no es éxito: el plan exige `201` y `CONFIRMADA`.

**Sin probar:** este plan no se ejecutó, porque JMeter no estaba disponible al escribirlo. Pruébalo antes de la primera corrida.
