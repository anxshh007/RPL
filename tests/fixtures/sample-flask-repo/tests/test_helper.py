def test_format_response():
    from src.flask.helper import format_response
    assert format_response("ok") == "Response: ok"
