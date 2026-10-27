# Estructura de carpetas

Las rutas de páginas y API reservadas contienen `.gitkeep`; Next.js no publica una ruta hasta que exista un `page.tsx` o un `route.ts` correspondiente.

```text
investigacion-blockchain/
├── src/
│   ├── app/
│   │   ├── globals.css                 # Generado por create-next-app
│   │   ├── layout.tsx                  # Generado por create-next-app
│   │   ├── page.tsx                    # Página mínima generada
│   │   ├── acceso/
│   │   ├── (prototipo)/
│   │   │   ├── datos/
│   │   │   ├── academico/
│   │   │   ├── laboratorio/
│   │   │   ├── trazabilidad/
│   │   │   └── experimentos/
│   │   └── api/v1/
│   │       ├── datos/
│   │       ├── academico/
│   │       ├── eventos/
│   │       ├── trazabilidad/
│   │       ├── privacidad/
│   │       ├── experimentos/
│   │       └── autenticacion/
│   ├── modules/
│   │   ├── datos/
│   │   ├── academico/
│   │   ├── eventos/
│   │   ├── trazabilidad/
│   │   ├── privacidad/
│   │   ├── experimentos/
│   │   └── autenticacion/
│   ├── server/
│   │   ├── mysql/
│   │   ├── fabric/
│   │   ├── crypto/
│   │   ├── storage-strategies/
│   │   ├── reconciliation/
│   │   ├── config/
│   │   └── observability/
│   └── shared/
│       ├── components/
│       ├── types/
│       └── validation/
├── public/                            # Solo recursos públicos futuros
├── database/
│   ├── source/                        # Instrucciones futuras de importación/validación
│   └── experimental/
│       ├── migrations/
│       └── seeds/                     # Datos ficticios futuros
├── chaincode/
│   ├── src/
│   └── test/
├── infra/
│   ├── mysql/
│   └── fabric/
│       ├── network/
│       └── connection-profiles/
├── benchmarks/caliper/
│   ├── connectors/
│   ├── workloads/
│   └── config/
├── scripts/
│   ├── data/
│   ├── reconciliation/
│   └── experiments/
├── tests/
│   ├── integration/
│   └── e2e/
├── data/
│   ├── source/                        # Ignorado; vacío
│   └── experimental/                  # Ignorado; vacío
├── artifacts/
│   ├── results/                       # Resultados futuros, ignorados
│   └── reports/                       # Informes futuros, ignorados
├── docs/
├── .env.example                       # Variables previstas, sin secretos
├── .gitignore
├── .node-version
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.json
├── eslint.config.mjs
└── next.config.ts
```

`node_modules/` contiene dependencias instaladas y `.next/` se genera al compilar o ejecutar. No son módulos del producto ni se versionan. `next-env.d.ts` y los tipos de rutas son generados por Next.js.

Se utiliza un único paquete de aplicación en la raíz. No se configura un monorepositorio ni workspaces adicionales: chaincode y Caliper solo tienen espacios reservados.
