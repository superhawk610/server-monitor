const express           = require('express')
const app               = express()
const sass              = require('node-sass-middleware')
const parse             = require('clf-parser')
const fs                = require('fs')
const path              = require('path')
const date              = require('date-and-time')
const mongoose          = require('mongoose')
mongoose.Promise        = require('bluebird')
const request           = require('request')
const LineByLineReader  = require('line-by-line')
const exec              = require('child_process').exec

const port              = 3000
const limit             = 10

const cfg               = JSON.parse(fs.readFileSync(path.join(__dirname, 'site.config')))
const db_user           = cfg.user
const db_pass           = cfg.pass
const db_host           = cfg.host
const db_port           = cfg.port
const db                = cfg.db

var IP                  = require('./models/IP')
var Device              = require('./models/Device')

/*
 * Available log components:
 * remote_addr
 * remote_user
 * time_local
 * request
 * status
 * body_bytes_sent
 * http_method
 * method
 * path
 * protocol
 */

if (app.get('env') === 'development') {
  app.locals.pretty = true
}

app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'pug')

app.use(sass({
  src: path.join(__dirname, 'build', 'scss'),
  dest: path.join(__dirname, 'public', 'css'),
  debug: false,
  includePaths: [ path.join(__dirname, 'build', 'scss') ],
  outputStyle: 'compressed',
  prefix: '/css'
}))
app.use(express.static(path.join(__dirname, 'public')))

mongoose.connect(`mongodb://${db_user}:${db_pass}@${db_host}:${db_port}/${db}?authSource=admin`, {
  useMongoClient: true
})

app.get('/', (req, res) => {
  res.redirect('/access')
})

app.get('/access', (req, res) => {
  parseLog((logs, offset) => {
    res.render('index', { route: 'access', logs: logs, offset: offset, limit: limit })
  })
})

app.get('/access/:offset', (req, res) => {
  parseLog((logs, offset) => {
    res.render('log', { logs: logs, offset: offset }, (err, render) => {
      res.json({
        offset: offset,
        html: render
      })
    })
  }, {
    offset: parseInt(req.params.offset)
  })
})

app.get('/status', (req, res) => {
  Device.find().sort([['ip', 1], ['port', 1]]).exec((err, devices) => {
    if (err) res.send(err)
    res.render('status', { route: 'status', devices: devices })
  })
})

app.get('/status/:ip/:port', (req, res) => {
  // -q timeout, in seconds
  // -z query port without sending packets
  var ip = req.params.ip || '127.0.0.1'
  var port = req.params.port || 80
  var cmd = `nc -q 5 -z ${ip} ${port}; echo $?`
  exec(cmd, (err, stdout, stderr) => {
    console.log(stdout)
    res.send((stdout.trim() == '0') ? 'online' : 'offline')
  })
})

app.get('/users', (req, res) => {
  res.render('users', { route: 'users', users: [
    { service: 'Employee Portal',
      users: [
        { name: 'username', last_login: '01/01/2017 12:00 AM', ip: '38.384.30.20' },
        { name: 'username', last_login: '01/01/2017 12:00 AM', ip: '38.384.30.20' },
        { name: 'username', last_login: '01/01/2017 12:00 AM', ip: '38.384.30.20' },
      ]
    },
    { service: 'Customer Portal',
      users: [
        { name: 'username', last_login: '01/01/2017 12:00 AM', ip: '38.384.30.20' },
        { name: 'username', last_login: '01/01/2017 12:00 AM', ip: '38.384.30.20' },
        { name: 'username', last_login: '01/01/2017 12:00 AM', ip: '38.384.30.20' },
      ]
    }
  ] })
})

app.get('/log', (req, res) => {
  parseLog((logs) => {
    res.json(logs)
  }, {
    limit: 99999
  })
})

app.get('/ip/:ip', (req, res) => {
  IP.findOne({ ip: req.params.ip }, (err, ip) => {
    if (ip === null) {
      request.get('https://ipapi.co/' + req.params.ip + '/json/', (error, response, body) => {
        if (error) console.log(error)
        var lookup = JSON.parse(body)
        var newIP = new IP()
        if (lookup.error) {
          newIP.ip = req.params.ip
          newIP.invalid = true
        } else {
          Object.keys(lookup).map((x) => {
            newIP[x] = lookup[x]
          })
        }
        newIP.first_encountered = new Date()
        newIP.save((err) => {
          if (err) console.log(err)
          res.json({ result: newIP, first_encountered: date.format(newIP.first_encountered, 'ddd, M/D, h:mm:ss A') })
        })
      })
    } else {
      if (err) res.send(err)
      res.json({ result: ip, first_encountered: date.format(ip.first_encountered, 'ddd, M/D, h:mm:ss A') })
    }
  })
})

app.listen(port, () => {
  console.log('Server monitor listening on port 3000!')
})

function parseLog(callback, options) {
  //var logsText = fs.readFileSync('/var/www/log/access.log', 'utf8').split('\n')
  var count = 0
  var shouldEnd = false
  var endingIP = 0
  if (options === undefined) var options = {}
  if (options.offset === undefined) options.offset = 0
  if (options.limit === undefined) options.limit = limit
  var offset = options.offset
  var lr = new LineByLineReader('/var/www/log/access.log', {
    encoding: 'utf8'
  })
  var logs = []
  lr.on('error', (err) => {
    console.log(err)
  })
  lr.on('line', (line) => {
    //console.log('read line:', line)
    if (offset > 0) {
      offset--
      return
    }
    var log = parse(line)
    if (shouldEnd) {
      if (log.remote_addr != endingIP) {
        lr.end()
        return
      }
    }
    logs.push(log)
    var i = logs.length-1
    logs[i].formatted_time = date.format(logs[i].time_local, 'dddd, M/D<br>h:mm:ss A')
    logs[i].request = (logs[i].request ? logs[i].request : 'no request')
    logs[i].http_method = (logs[i].http_method ? logs[i].http_method : '???')
    count++
    if (count >= options.limit) {
      shouldEnd = true
      endingIP = log.remote_addr
    }
  })
  lr.on('end', () => {
    if (callback) callback(logs, options.offset + count)
  })
}
