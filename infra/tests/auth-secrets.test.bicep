test off 'auth-secrets.fixture.bicep' = {
  params: {
    authConfigured: false
    googleAuthConfigured: true
    microsoftAuthConfigured: true
  }
}

test googleOnly 'auth-secrets.fixture.bicep' = {
  params: {
    authConfigured: true
    googleAuthConfigured: true
    microsoftAuthConfigured: false
  }
}

test microsoftOnly 'auth-secrets.fixture.bicep' = {
  params: {
    authConfigured: true
    googleAuthConfigured: false
    microsoftAuthConfigured: true
  }
}

test both 'auth-secrets.fixture.bicep' = {
  params: {
    authConfigured: true
    googleAuthConfigured: true
    microsoftAuthConfigured: true
  }
}
