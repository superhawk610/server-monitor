var mongoose = require('mongoose')
var Schema = mongoose.Schema

var DeviceSchema = new Schema({
  name: String,
  ip: String,
  mac: String,
  port: String,
  make: String,
  model: String,
  icon: String,
  tags: [{
    name: String,
    category: String
  }],
  description: {
    tagline: String,
    short: String,
    full: String,
    hide: Boolean
  },
  credentials: [{
    user: String,
    pass: String
  }]
})

module.exports = mongoose.model('Device', DeviceSchema)
