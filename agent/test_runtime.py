from main import check_path

def test_tool_scope():
    assert check_path('/api/v1/products?limit=10', 'GET')
    assert check_path('/api/v1/production-batches', 'POST')
    assert not check_path('/api/v1/approvals/123', 'POST')
    assert not check_path('/api/v1/api-keys', 'GET')
    assert not check_path('/api/v1/channels', 'POST')
    assert not check_path('/api/v1/products/../../internal', 'POST')
    assert not check_path('https://attacker.example', 'GET')


def test_quote_scope_is_exact():
    assert check_path('/api/v1/billing/quotes', 'POST')
    assert check_path('/api/v1/billing/wallet', 'GET')
    assert not check_path('/api/v1/billing/quotes', 'PATCH')
    assert not check_path('/api/v1/billing/quotes/extra', 'POST')
    assert not check_path('/api/v1/billing/ledger', 'POST')
    assert not check_path('/api/v1/platform/rates', 'POST')
