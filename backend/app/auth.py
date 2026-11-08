"""Auth0 access-token verification for FastAPI.

Auth0 handles the login screen. The browser sends the access token it gets back as
`Authorization: Bearer <token>`; this module checks it (RS256 signature against the
tenant's public keys, issuer, audience, expiry) and returns the user id (`sub`).

Nothing in the browser is trusted for identity: the user id always comes from a verified
token. If AUTH0_DOMAIN / AUTH0_AUDIENCE are not set, sign-in is simply not configured and
protected endpoints answer 503, while every public endpoint keeps working.
"""
from __future__ import annotations

import os
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException


def auth_config() -> tuple[str, str] | None:
    domain = os.environ.get("AUTH0_DOMAIN", "").strip().removeprefix("https://").strip("/")
    audience = os.environ.get("AUTH0_AUDIENCE", "").strip()
    return (domain, audience) if domain and audience else None


@lru_cache(maxsize=4)
def _jwks_client(domain: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"https://{domain}/.well-known/jwks.json", cache_keys=True)


def _signing_key(token: str, domain: str):
    """Separate so tests can supply a key without contacting Auth0."""
    return _jwks_client(domain).get_signing_key_from_jwt(token).key


def current_user(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: the verified Auth0 user id, or 401/503."""
    cfg = auth_config()
    if cfg is None:
        raise HTTPException(status_code=503, detail="Sign-in is not configured on this server.")
    domain, audience = cfg
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in first.")
    token = authorization[7:].strip()
    try:
        claims = jwt.decode(
            token,
            _signing_key(token, domain),
            algorithms=["RS256"],
            audience=audience,
            issuer=f"https://{domain}/",
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except Exception:
        # Do not say why: expired, wrong audience and forged all look the same to a caller.
        raise HTTPException(status_code=401, detail="Your sign-in is not valid. Please sign in again.")
    return str(claims["sub"])
