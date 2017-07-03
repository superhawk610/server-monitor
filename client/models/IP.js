var mongoose = require('mongoose')
var Schema = mongoose.Schema

var IPSchema = new Schema({
  ip: String,
  city: String,
  region: String,
  country: String,
  country_name: String,
  postal: String,
  latitude: String,
  longitude: String,
  timezone: String,
  asn: String,
  org: String,
  first_encountered: Date
})

module.exports = mongoose.model('IP', IPSchema)
