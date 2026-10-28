// Client-side subject for infra/tests/ingress-rules.test.bicep.
// The block between the markers must match infra/modules/container-app.bicep.
param restrictPublicAccess bool

param allowedIpRanges string[]

param minAllowedPrefixLength int = 16

// ingress-ip-rules:begin
// Azure accepts only Allow rules or only Deny rules, and an empty rule list allows
// every client. An empty allowlist still sends one Allow rule for 192.0.2.1/32
// (RFC 5737 TEST-NET-1, not a client). Every other IPv4 source misses that rule
// and receives HTTP 403. restrictPublicAccess false is the only way to send [],
// which Azure treats as allow all, and only after story #15.
// Octets are decimal, 0-255, with no leading zeros. The prefix is /minAllowedPrefixLength through /32.
func isOctet(o string) bool => length(o) >= 1 && length(o) <= 3 && empty(filter(range(0, length(o)), i => !contains('0123456789', substring(o, i, 1)))) && string(int(o)) == o && int(o) <= 255
func isIpv4Cidr(r string, minPrefix int) bool => length(split(r, '/')) == 2 && length(split(split(r, '/')[0], '.')) == 4 && empty(filter(split(split(r, '/')[0], '.'), o => !isOctet(o))) && isOctet(split(r, '/')[1]) && int(split(r, '/')[1]) >= minPrefix && int(split(r, '/')[1]) <= 32

var normalizedIpRanges = union(filter(map(allowedIpRanges, r => trim(r)), r => !empty(r)), [])
var invalidIpRanges = filter(normalizedIpRanges, r => !isIpv4Cidr(r, minAllowedPrefixLength))
var allowlistAccepted = empty(invalidIpRanges) ? true : fail('allowedIpRanges entries must be IPv4 CIDRs with a prefix from /${minAllowedPrefixLength} to /32: ${join(invalidIpRanges, ', ')}')

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

// The false branch is unreachable while fail() aborts on invalidIpRanges. It stays
// the closed rule so a later edit cannot fall through to an empty list (allow all).
var ipSecurityRestrictions = allowlistAccepted
  ? (restrictPublicAccess ? (empty(normalizedIpRanges) ? closedAllowlistRule : allowIpRules) : [])
  : closedAllowlistRule
// ingress-ip-rules:end

assert whenClosed = restrictPublicAccess && empty(normalizedIpRanges) ? (length(ipSecurityRestrictions) == 1 && ipSecurityRestrictions[0].ipAddressRange == '192.0.2.1/32' && ipSecurityRestrictions[0].name == 'closed-until-allowlist' && ipSecurityRestrictions[0].action == 'Allow') : true

assert whenListed = restrictPublicAccess && length(normalizedIpRanges) == 2 ? (length(ipSecurityRestrictions) == 2 && ipSecurityRestrictions[0].name == 'allow-0' && ipSecurityRestrictions[0].ipAddressRange == normalizedIpRanges[0] && ipSecurityRestrictions[0].action == 'Allow' && ipSecurityRestrictions[1].name == 'allow-1' && ipSecurityRestrictions[1].ipAddressRange == normalizedIpRanges[1] && ipSecurityRestrictions[1].action == 'Allow') : true

assert whenDeduped = restrictPublicAccess && length(normalizedIpRanges) == 1 && length(allowedIpRanges) > 1 ? (length(ipSecurityRestrictions) == 1 && ipSecurityRestrictions[0].name == 'allow-0' && ipSecurityRestrictions[0].ipAddressRange == normalizedIpRanges[0] && ipSecurityRestrictions[0].action == 'Allow') : true

assert whenPrefix16 = restrictPublicAccess && length(normalizedIpRanges) == 1 && normalizedIpRanges[0] == '203.0.113.0/16' ? (length(ipSecurityRestrictions) == 1 && ipSecurityRestrictions[0].ipAddressRange == '203.0.113.0/16' && ipSecurityRestrictions[0].action == 'Allow') : true

assert whenCustomFloor = minAllowedPrefixLength == 24 && length(normalizedIpRanges) == 1 && normalizedIpRanges[0] == '198.51.100.0/24' ? (length(ipSecurityRestrictions) == 1 && ipSecurityRestrictions[0].ipAddressRange == '198.51.100.0/24' && ipSecurityRestrictions[0].action == 'Allow') : true

assert whenOpen = !restrictPublicAccess ? empty(ipSecurityRestrictions) : true
