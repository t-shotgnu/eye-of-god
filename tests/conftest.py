import pytest
from fastapi.testclient import TestClient

from prick.app import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        yield client


@pytest.fixture
def csrf(client):
    return client.app.state.csrf
