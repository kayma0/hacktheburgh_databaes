"""Auth0 access tokens made locally, signed with our own key (no Auth0 tenant needed)."""
import time

import jwt as pyjwt
from cryptography.hazmat.primitives.asymmetric import rsa

DOMAIN, AUD = "test-tenant.eu.auth0.com", "https://sicklesignal.test/api"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def token(sub="auth0|alice", key=KEY, aud=AUD, iss=f"https://{DOMAIN}/", exp_in=300):
    claims = {"sub": sub, "aud": aud, "iss": iss, "exp": int(time.time()) + exp_in}
    return pyjwt.encode(claims, key, algorithm="RS256")


def auth_header(**kw):
    return {"Authorization": f"Bearer {token(**kw)}"}
