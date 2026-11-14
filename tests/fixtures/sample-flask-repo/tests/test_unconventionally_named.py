from src.flask.helper import format_response

def test_custom_formatting():
    assert format_response("custom") == "Response: custom"
