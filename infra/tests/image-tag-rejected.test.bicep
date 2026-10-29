test initial 'image-tag.fixture.bicep' = {
  params: {
    tag: 'initial'
    deploying: true
  }
}

test empty 'image-tag.fixture.bicep' = {
  params: {
    tag: ''
    deploying: true
  }
}
