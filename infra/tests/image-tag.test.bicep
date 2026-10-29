test open 'image-tag.fixture.bicep' = {
  params: {
    tag: ''
    deploying: false
  }
}

test sha 'image-tag.fixture.bicep' = {
  params: {
    tag: 'abc'
    deploying: true
  }
}
