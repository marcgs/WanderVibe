// These evaluations must fail. check-access-restrictions.sh expects a non-zero exit.

test world 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      ' 0.0.0.0/0 '
    ]
  }
}

test broad 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '10.0.0.0/0'
    ]
  }
}

test openWorld 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: false
    allowedIpRanges: [
      '0.0.0.0/0'
    ]
  }
}

test hostOnly 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '203.0.113.10'
    ]
  }
}
