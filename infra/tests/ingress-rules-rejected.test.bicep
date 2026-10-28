// These evaluations must fail. check-access-restrictions.sh expects each message below.

test prefix3 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '203.0.113.10/3'
    ]
  }
}

test prefix1 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '0.0.0.0/1'
    ]
  }
}

test leadingZeroPrefix 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '1.2.3.4/00'
    ]
  }
}

test foo 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      'foo/32'
    ]
  }
}

test octet256 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '1.2.3.256/32'
    ]
  }
}

test ipv6 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '2001:db8::/64'
    ]
  }
}

test bare 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '1.2.3.4'
    ]
  }
}

test leadingZeroOctet 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '01.2.3.4/32'
    ]
  }
}

test prefix15 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '203.0.113.0/15'
    ]
  }
}

test belowCustomFloor 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    minAllowedPrefixLength: 24
    allowedIpRanges: [
      '198.51.100.0/20'
    ]
  }
}

test extraSlash 'ingress-rules.bicep' = {
  params: {
    restrictPublicAccess: true
    allowedIpRanges: [
      '1.2.3.4/32/1'
    ]
  }
}
