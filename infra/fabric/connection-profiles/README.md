# Perfiles de conexión (ignorados por git)

`pnpm fabric:up` (por medio de `network/perfiles.sh`) copia aquí la identidad cliente de laboratorio y el CA TLS del peer:

```text
org1/user1-cert.pem     certificado de User1@org1.example.com (usuario de laboratorio, sin datos personales)
org1/user1-key.pem      clave privada (permisos 600)
org1/peer0-tls-ca.pem   CA TLS de peer0.org1
```

Las rutas se ponen en `.env` (`FABRIC_CERT_PATH`, `FABRIC_KEY_PATH` y `FABRIC_TLS_CERT_PATH`) y solo las usa el servidor. `pnpm fabric:down` borra este contenido. Fuera de este README, nada de esta carpeta entra al repositorio.
