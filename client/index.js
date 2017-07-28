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
const AWS               = require('aws-sdk')
const moment            = require('moment')
const uuid              = require('uuid/v4')
const archiver          = require('archiver')
const bodyParser        = require('body-parser')

const port              = 3000
const limit             = 10

const cfg               = JSON.parse(fs.readFileSync(path.join(__dirname, 'site.config')))
const db_user           = cfg.user
const db_pass           = cfg.pass
const db_host           = cfg.host
const db_port           = cfg.port
const db                = cfg.db
const api_key           = cfg.api_key

var Backup              = require('./models/Backup')
var IP                  = require('./models/IP')
var Device              = require('./models/Device')

var jobs                = JSON.parse(fs.readFileSync(path.join(__dirname, 'active_jobs.json')))

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
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

app.locals.moment = moment

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
    //console.log(stdout)
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

app.get('/backups', (req, res) => {
  Backup.find({}, (err, backups) => {
    res.render('backups', { route: 'backups', backups: backups, activeJobs: jobs })
  })
})

app.put('/backups', (req, res) => {
  var glacier   = new AWS.Glacier({ region: 'us-east-2', apiVersion: '2012-06-01' }),
      vaultName = 'main-backup',
      // buffer    = new Buffer(2.5 * 1024 * 1024), // 2.5MB buffer
      desc      = 'sm-backup-' + moment().format('MM-DD-YYYY'),
      jobId     = uuid()
      job       = {
        name: desc,
        date: new Date(),
        status: 0
      }

  console.log(req.body)
  archiveDir(req.body.path, (filename) => {
    job.status = 1
    var buffer = fs.readFileSync(filename)
    var params = { vaultName: vaultName, body: buffer, archiveDescription: desc }

    glacier.uploadArchive(params, (err, data) => {
      if (err) console.log('Error uploading archive!', err)
      else {
        console.log('Archive ID', data.archiveId)
        delete jobs[jobId]
        delete job.status
        job.date = new Date()
        job.id = data.archiveId
        var backup = new Backup(job)
        backup.save(() => {
          console.log('Archive logged to DB')
          fs.writeFile(path.join(__dirname, 'active_jobs.json'), JSON.stringify(jobs), () => {
            console.log('Job listing updated')
          })
          fs.unlink(filename)
        })
      }
    })
  })

  jobs[jobId] = job
  fs.writeFile(path.join(__dirname, 'active_jobs.json'), JSON.stringify(jobs), () => {
    res.status(200).json({ message: 'Job started, refresh the page to see its progress', job: job })
  })
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

function archiveDir(dir, callback) {
  // create a file to stream archive data to. 
  var result = path.join(__dirname, 'archive-' + uuid() + '.tar.gz')
  var output = fs.createWriteStream(result)
  var archive = archiver('tar', {
    gzip: true,
    gzipOptions: { level: 9 } // Sets the compression level. 
  })
  
  output.on('close', () => {
    console.log(archive.pointer() + ' total bytes')
    console.log('archiver has been finalized and the output file descriptor has closed.')
    callback(result)
  })
  
  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
        // log warning 
    } else {
        // throw error 
        throw err
    }
  })
  
  archive.on('error', (err) => {
    throw err
  })

  archive.directory(dir, false)
  
  archive.pipe(output);  
  archive.finalize()
}

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
