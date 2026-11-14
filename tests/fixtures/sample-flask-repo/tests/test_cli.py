def test_get_debug_flag():
    from src.flask.cli import get_debug_flag
    assert get_debug_flag() is True

def test_cli_run():
    from src.flask.cli import cli_run
    assert cli_run() == "running cli"
