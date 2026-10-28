// Client-side subject for infra/tests/ingress-rules.test.bicep.
// The block between the markers must match infra/modules/container-app.bicep.
param restrictPublicAccess bool

param allowedIpRanges string[]

// ingress-ip-rules:begin
// Azure accepts only Allow rules or only Deny rules, and an empty rule list allows
// every client. An empty allowlist still sends one Allow rule for 192.0.2.1/32
// (RFC 5737 TEST-NET-1, not a client). Every other IPv4 source misses that rule
// and receives HTTP 403. restrictPublicAccess false is the only way to send [],
// which Azure treats as allow all, and only after story #15.
var normalizedIpRanges = filter(map(allowedIpRanges, range => trim(range)), range => !empty(range))

var allowlistAccepted = !empty(filter(normalizedIpRanges, range => endsWith(range, '/0')))
  ? fail(
      'allowedIpRanges must not contain a /0 prefix. To open ingress after story #15, set restrictPublicAccess to false.'
    )
  : !empty(filter(normalizedIpRanges, range => !contains(range, '/')))
      ? fail('Each allowedIpRanges entry must be an IPv4 CIDR, for example 203.0.113.10/32.')
      : true

var closedAllowlistRule = [
  {
    name: 'closed-until-allowlist'
    description: 'Empty allowlist. This documentation address is not a client.'
    ipAddressRange: '192.0.2.1/32'
    action: 'Allow'
  }
]

var allowIpRules = [
  for (range, index) in normalizedIpRanges: {
    name: 'allow-${index}'
    description: 'Deploy-time allowlist entry.'
    ipAddressRange: range
    action: 'Allow'
  }
]

var ipSecurityRestrictions = allowlistAccepted
  ? (restrictPublicAccess ? (empty(normalizedIpRanges) ? closedAllowlistRule : allowIpRules) : [])
  : []
// ingress-ip-rules:end

assert whenClosed = restrictPublicAccess && empty(normalizedIpRanges) ? (length(ipSecurityRestrictions) == 1 && ipSecurityRestrictions[0].ipAddressRange == '192.0.2.1/32' && ipSecurityRestrictions[0].name == 'closed-until-allowlist' && ipSecurityRestrictions[0].action == 'Allow') : true

assert whenListed = restrictPublicAccess && length(normalizedIpRanges) == 2 ? (length(ipSecurityRestrictions) == 2 && ipSecurityRestrictions[0].name == 'allow-0' && ipSecurityRestrictions[0].ipAddressRange == normalizedIpRanges[0] && ipSecurityRestrictions[0].action == 'Allow' && ipSecurityRestrictions[1].name == 'allow-1' && ipSecurityRestrictions[1].ipAddressRange == normalizedIpRanges[1] && ipSecurityRestrictions[1].action == 'Allow') : true

assert whenOpen = !restrictPublicAccess ? empty(ipSecurityRestrictions) : true
