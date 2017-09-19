'use strict';
var mongoose = require('mongoose')
var Schema = mongoose.Schema

var IPSchema = new Schema({
  ip: { type: String, unique: true },
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
  invalid: { type: Boolean, default: false },
  first_encountered: Date
})

module.exports = mongoose.model('IP', IPSchema)
