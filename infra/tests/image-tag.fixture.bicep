import { requireImageTag } from '../modules/image-tag.bicep'

param tag string
param deploying bool

var checked = requireImageTag(tag, deploying)

assert accepted = !deploying || checked == tag
