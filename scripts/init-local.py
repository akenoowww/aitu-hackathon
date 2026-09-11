#!/usr/bin/env python3
"""Initialize unique local credentials; never overwrite an existing environment."""

import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parent.parent
target = root / ".env"
content = "\n".join(
    [
        "# Local-only environment. Keep this file private and out of version control.",
        f"POSTGRES_PASSWORD={secrets.token_hex(24)}",
        "BOOTSTRAP_EMAIL=admin@example.com",
        f"BOOTSTRAP_PASSWORD={secrets.token_urlsafe(24)}",
        "WEB_PORT=8787",
        "APP_ENV=development",
        "COOKIE_SECURE=false",
        "ALLOWED_ORIGINS=http://localhost:8787,http://127.0.0.1:8787",
        "",
    ]
)
try:
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    print(".env already exists; preserved without changes.")
else:
    with os.fdopen(fd, "w") as file:
        file.write(content)
    print("Created private .env with unique database and administrator credentials.")
