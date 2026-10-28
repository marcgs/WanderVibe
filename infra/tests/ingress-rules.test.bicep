// Supplies parameters to infra/tests/ingress-rules.bicep. Not deployed.

test closed 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: []
  }
}

test blank 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      ' '
      ''
    ]
  }
}

test listed 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      ' 203.0.113.10/32 '
      ''
      '198.51.100.0/24'
    ]
  }
}

test open 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: false
    allowedIpRanges: [
      '203.0.113.10/32'
    ]
  }
}

test deduped 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '203.0.113.10/32'
      ' 203.0.113.10/32 '
    ]
  }
}
