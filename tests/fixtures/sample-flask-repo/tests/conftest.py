import pytest

@pytest.fixture
def sample_app():
    return {"name": "flask-test-app"}
