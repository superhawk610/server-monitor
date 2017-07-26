var mongoose = require('mongoose')
var Schema = mongoose.Schema

var BackupSchema = new Schema({
  id: String,
  date: Date,
  name: String
})

module.exports = mongoose.model('Backup', BackupSchema)
