'use strict';
const express           = require('express')
const app               = express()
const sass              = require('node-sass-middleware')
const parse             = require('clf-parser')
const fs                = require('fs')
const path              = require('path')
const date              = require('date-and-time')
const mongoose          = require('mongoose')
mongoose.Promise        = require('bluebird')
const mysql             = require('promise-mysql')
const request           = require('request')
const LineByLineReader  = require('line-by-line')
const exec              = require('child_process').exec
const AWS               = require('aws-sdk')
const treehash          = require('treehash')
const moment            = require('moment')
const uuid              = require('uuid/v4')
const archiver          = require('archiver')
const bodyParser        = require('body-parser')
const csv               = require('csv-parse')
const fileSelect        = require('@superhawk610/file-select')

const port              = 3000
const limit             = 10
const chunkSize         = Math.pow(2, 23) // ~ 8 MB
const jobFile           = path.join(__dirname, 'active_jobs.json')
const jobUpdateTime     = 5 * 60 * 1000

const glacier           = new AWS.Glacier({ region: 'us-east-2', apiVersion: '2012-06-01' })
const vaultName         = 'main-backup'

const cfg               = JSON.parse(fs.readFileSync(path.join(__dirname, 'site.config')))
const db_user           = cfg.user
const db_pass           = cfg.pass
const db_host           = cfg.host
const db_port           = cfg.port
const db                = cfg.db
const api_key           = cfg.api_key
const noAuth            = (cfg.noAuth ? '' : '?authSource=admin')

var Backup              = require('./models/Backup')
var IP                  = require('./models/IP')
var Device              = require('./models/Device')

var jobs
fs.readFile(jobFile, 'utf8', (err, data) => {
  if (err) jobs = {}
  else {
    if (data == '') jobs = {}
    else jobs = JSON.parse(data)
    if (Object.keys(jobs).length) {
      for (var i = 0; i < Object.keys(jobs).length; i++) {
        let job = jobs[Object.keys(jobs)[i]]
        if (job.type == 'backup' && job.bytes) {
          job.currentChunkIndex = job.currentChunkIndex - 1
          uploadChunk(job, job.currentChunkIndex)
        }
      }
    }
  }
})

/**
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

/**
 * listing.csv Format:
 * ArchiveId
 * ArchiveDescription
 * CreationDate
 * Size
 * SHA256TreeHash
 */

if (app.get('env') === 'development') {
  app.locals.pretty = true
}

app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'pug')

app.use(fileSelect({
  path: '/'
}))
app.use(sass({
  src: path.join(__dirname, 'build', 'scss'),
  dest: path.join(__dirname, 'public', 'css'),
  debug: false,
  includePaths: [ path.join(__dirname, 'build', 'scss') ],
  outputStyle: 'compressed',
  prefix: '/css'
}))
app.get('/js/main.js', (req, res) => {
  fs.readFile(path.join(__dirname, 'public/js/main.js'), 'utf8', (err, file) => {
    res.type('text/javascript').send(file.replace(/#APIKEY#/g, api_key))
  })
})
app.use(express.static(path.join(__dirname, 'public')))
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

app.locals.moment = moment

var auth = `${db_user}:${db_pass}@`
if (!db_pass) auth = ''
mongoose.connect(`mongodb://${auth}${db_host}:${db_port}/${db}${noAuth}`, {
  useMongoClient: true
})

app.get('/', (req, res) => {
  res.redirect('/access')
})

app.get('/access', (req, res) => {
  fs.readdir('/var/www/log/old', (err, files) => {
    if (err) console.log(err)
    else {
      parseLog('/var/www/log/access.log', (logs, offset) => {
        res.render('index', {
          route: 'access',
          refreshPath: '/access/',
          logs: logs,
          historicalLogs: files.filter(x => x != '.' && x != '..'),
          offset: offset,
          limit: limit
        })
      })
    }
  })
})

app.get('/historical/:log', (req, res) => {
  fs.readdir('/var/www/log/old/', (err, files) => {
    if (err) console.log(err)
    else {
      parseLog(`/var/www/log/old/${req.params.log}`, (logs, offset) => {
        res.render('index', {
          route: 'access',
          refreshPath: `/historical/${req.params.log}/`,
          logs: logs,
          historicalLogs: files.filter(x => x != '.' && x != '..'),
          offset: offset,
          limit: limit })
      })
    }
  })
})

app.get('/access/:offset', (req, res) => {
  parseLog('/var/www/log/access.log', (logs, offset) => {
    res.render('log', { logs: logs, offset: offset }, (err, render) => {
      if (err) console.log(err)
      res.json({
        offset: offset,
        html: render
      })
    })
  }, {
    offset: parseInt(req.params.offset)
  })
})

app.get('/historical/:log/:offset', (req, res) => {
  parseLog(`/var/www/log/old/${req.params.log.replace(/[\/\\]/g, '')}`, (logs, offset) => {
    res.render('log', { logs: logs, offset: offset }, (err, render) => {
      if (err) console.log(err)
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
  mysql.createConnection({
    host: cfg.host,
    user: cfg.user,
    password: cfg.pass,
    database: 'cid_dev'
  }).then(conn => {
    conn.query(`SELECT * FROM users`).then(e_users => {
      conn.query(`SELECT * FROM users_customer`).then(c_users => {
        res.render('users', { route: 'users', users: [
          { service: 'Employee Portal',
            users: e_users.map(x => { return {
              name: [ x.FirstName, x.LastName ].join(' '),
              last_login: date.format(x.LastLoginTimestamp, 'ddd, M/D, h:mm:ss A'),
              ip: x.LastLoginIP
            } })
          },
          { service: 'Customer Portal',
            users: c_users.map(x => {
              return {
                name: [ x.FirstName, x.LastName ].join(' '),
                last_login: date.format(x.LastLoginTimestamp, 'ddd, M/D, h:mm:ss A'),
                ip: 'Unknown'
              }
            })
          }
        ] })
        conn.end()
      })
    })
  })
})

app.get('/log', (req, res) => {
  parseLog('/var/www/log/access.log', logs => {
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
        try { var lookup = JSON.parse(body) }
        catch (e) {
          if (e) {
            console.log(e)
            var newIP = new IP()
            newIP.ip = req.params.ip
            newIP.invalid = true
            newIP.first_encountered = new Date()
            res.json({ result: newIP, first_encountered: date.format(newIP.first_encountered, 'ddd, M/D, h:mm:ss A') })
          } else {
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
          }
        }
      })
    } else {
      if (err) res.send(err)
      res.json({ result: ip, first_encountered: date.format(ip.first_encountered, 'ddd, M/D, h:mm:ss A') })
    }
  })
})

app.get('/backups', (req, res) => {
  Backup.find({}, (err, backups) => {
    fs.stat(path.join(__dirname, 'listing.csv'), (err, stats) => {
      if (!err) {
        fs.readFile(path.join(__dirname, 'listing.csv'), 'utf-8', (err, data) => {
          csv(data, { columns: true }, (err, data) => {
            if (err) console.log(err)
            res.render('backups', { route: 'backups', backups: backups, listing: data, listingExists: true, activeJobs: jobs })
          })
        })
      } else res.render('backups', { route: 'backups', backups: backups, listing: [], listingExists: false, activeJobs: jobs })
    })
  })
})

app.post('/backups/server', (req, res) => {
  if (req.body.api_key != api_key) {
    if (req.body.key != api_key) {
      return res.status(403).json({ message: 'Please provide a valid API key to initiate this request.' })
    }
  }
  res.status(200).json({ message: 'Retrieval job initiated. Please check back when the job is ready.' })

  var params = {
    vaultName: vaultName,
    jobParameters: {
      Description: `Retrieval job for archive listing`,
      Type: 'inventory-retrieval',
      Format: 'CSV'
    }
  }

  var job = {
    name: 'Archive Listing',
    type: 'listing',
    date: new Date(),
    status: 0
  }

  glacier.initiateJob(params, (err, data) => {
    if (err) console.log(err, err.stack)
    console.log('Archive listing initiated:')
    console.log('Location:', data.location)
    console.log('Job ID:', data.jobId)
    job.jobId = data.jobId
    jobs[job.jobId] = job
    fs.writeFile(jobFile, JSON.stringify(jobs))
    checkJobStatus(job)
  })
})

app.post('/backups', (req, res) => {
  if (req.body.api_key != api_key) {
    if (req.body.key != api_key) {
      return res.status(403).json({ message: 'Please provide a valid API key to initiate this request.' })
    }
  }
  if (!req.body.archive) {
    return res.status(400).json({ message: 'Please provide an archive to retrieve.' })
  }
  var archiveId = req.body.archive
  res.status(200).json({ message: 'Retrieval job initiated. Please check back when the job is ready.' })

  var params = {
    vaultName: vaultName,
    jobParameters: {
      Description: `Retrieval job for ${archiveId}`,
      Type: 'archive-retrieval',
      ArchiveId: archiveId
    }
  }
  var job = {
    name: `Retrieval job for ${archiveId.substring(0, 15)}...`,
    type: 'retrieval',
    vaultName: vaultName,
    date: new Date(),
    status: 0,
    archiveId: archiveId
  }

  console.log('initiating retrieval job for archive ' + archiveId)
  glacier.initiateJob(params, (err, data) => {
    if (err) console.log(err, err.stack)
    else {
      console.log('retrieval job initiated with jobId ' + data.jobId)
      job.jobId = data.jobId
      jobs[job.jobId] = job
      fs.writeFile(jobFile, JSON.stringify(jobs))
      checkJobStatus(job)
    }
  })
})

app.post('/download', (req, res) => {
  if (req.body.api_key != api_key) {
    if (req.body.key != api_key) {
      return res.status(403).json({ message: 'Please provide a valid API key to initiate this request.' })
    }
  }
  if (!req.body.jobId) {
    return res.status(400).json({ message: 'Please provide an jobId to download.' })
  }
  var jobId = req.body.jobId
  var job = jobs[jobId]
  if (job.status == 2) {
    res.status(200).json({ message: `Initiating download for complete job ${jobId}` })
    downloadJob(job)
  } else {
    res.status(200).json({ message: `Updating status for incomplete job ${jobId}`})
    checkJobStatus(job)
  }
})

app.delete('/backups', (req, res) => {
  if (req.body.api_key != api_key) {
    if (req.body.key != api_key) {
      return res.status(403).json({ message: 'Please provide a valid API key to initiate this request.' })
    }
  }
  if (!req.body.archive) {
    return res.status(400).json({ message: 'Please provide an archive to delete.' })
  }
  var archiveId = req.body.archive

  // delete from Glacier
  var params = {
    vaultName: vaultName,
    archiveId: archiveId
  }
  glacier.deleteArchive(params, (err, data) => {
    if (err) {
      console.log(err)
      res.status(500).json({ message: 'Could not delete archive from Glacier.' })
    } else {
      console.log(`successfully removed archive ${params.archiveId}`)
      console.log(`from vault ${params.vaultName}`)
      // delete from local listing
      Backup.remove({ archiveId: archiveId }, (err) => {
        if (err) {
          console.log(err)
          res.status(500).json({ message: `Archive deleted from Glacier but local listing persisted. Please manually remove DB entry with archiveId ${archiveId}` })
        } else res.status(200).json({ message: 'Archive successfully deleted.' })
      })
    }
  })
})

app.put('/backups', (req, res) => {
  if (req.body.api_key != api_key) {
    if (req.body.key != api_key) {
      return res.status(403).json({ message: 'Please provide a valid API key to initiate this request.' })
    }
  }
  if (!req.body.path) {
    return res.status(400).json({ message: 'Please provide a path to backup.' })
  }
  var job = {
    jobId: uuid(),
    type: 'backup',
    vaultName: vaultName,
    name: req.body.desc + '-backup-' + moment().format('MM-DD-YYYY'),
    date: new Date(),
    status: 0,
    path: req.body.path,
    archiverTotalSize: 0,
    archiverSizeProgress: 0,
    archiverTotalFiles: 0,
    archiverFilesProgress: 0
  }

  archiveDir(job, (_job) => {
    initiateUpload(_job)
  })

  jobs[job.jobId] = job
  fs.writeFile(jobFile, JSON.stringify(jobs), () => {
    res.status(200).json({ message: 'Job started, refresh the page to see its progress', job: job })
  })
})


app.listen(port, () => {
  console.log('Server monitor listening on port 3000!')
})

function checkJobStatus(job) {
  var params = {
    jobId: job.jobId,
    vaultName: vaultName
  }
  try {
    glacier.describeJob(params, (err, data) => {
      if (err) console.log(err, err.stack)
      else {
        var status = data.StatusCode // InProgress, Succeeded, Failed
        switch (status) {
          case 'InProgress':
            job.status = 1
            setTimeout(() => {
              checkJobStatus(job)
            }, jobUpdateTime)
            break;
          case 'Succeeded':
            job.status = 2
            job.bytes = data.InventorySizeInBytes
            downloadJob(job)
            break;
          case 'Failed':
            job.status = 3
            job.errorMessage = data.StatusMessage
            break;
          default:
            console.log('Unknown StatusCode encountered:', status)
            return
          }
        console.log(`job ${job.jobId} is ${status}`)
        jobs[job.jobId] = job
        fs.writeFile(jobFile, JSON.stringify(jobs))
      }
    })
  } catch (e) {
    // job doesn't exist
    delete jobs[job.jobId]
    fs.writeFile(jobFile, JSON.stringify(jobs))
  }
}

function downloadJob(job) {
  console.log(`downloading job with length ${job.bytes} bytes`)
  job.localPath = path.join(__dirname, 'downloads', 'job-' + job.jobId + (job.type == 'listing' ? '.csv' : '.tar.gz'))
  var params = {
    vaultName: vaultName,
    jobId: job.jobId
  }
  if (job.bytes < chunkSize) {
    console.log('selecting single part download')
    fs.open(job.localPath, 'w', (err, fd) => {
      if (err) console.log(err)
      glacier.getJobOutput(params, (err, data) => {
        fs.writeFile(fd, data.body, err => {
          if (err) console.log(err)
          fs.close(fd, (err) => { if (err) console.log(err) })
          completeDownload(job)
        })
      })
    })
  } else {
    console.log('selecting multipart download')
    job.currentChunkIndex = 0
    downloadChunk(job, 0)
  }
}

function downloadChunk(job, chunkIndex) {
  console.log('downloading chunk ' + (chunkIndex + 1) + ' of ' + job.pieces)
  var offset = chunkIndex * chunkSize
  var length = chunkIndex == job.pieces - 1 ? job.bytes % chunkSize : chunkSize
  var end = offset + length - 1
  console.log(`chunk stats | start: ${offset} | length: ${length} | end: ${end}`)
  var params = {
    vaultName: vaultName,
    jobId: job.jobId,
    range: `bytes=${offset}-${end}`
  }
  fs.open(job.localPath, 'a', (err, fd) => {
    if (err) console.log(err)
    fs.write(fd, data.body, 0, (err) => {
      if (err) console.log(err)
      if (chunkIndex == job.pieces - 1) {
        console.log('chunk ' + (chunkIndex + 1) + ' downloaded successfully, completing upload')
        fs.close(fd)
        completeDownload(job)
      } else {
        console.log('chunk ' + (chunkIndex + 1) + ' downloaded successfully, beginning next chunk')
        job.currentChunkIndex = chunkIndex + 1
        uploadChunk(job, chunkIndex + 1)  // continue upload with next chunk
      }
    })
  })
  jobs[job.jobId] = job
  fs.writeFile(jobFile, JSON.stringify(jobs))
}

function completeDownload(job) {
  switch (job.type) {
    case 'retrieval':
      Backup.findOneAndUpdate({ archiveId: job.archiveId }, { localPath: job.localPath }, { upsert: false }, (err, backup) => {
        if (err) console.log(err)
      })
      break
    case 'listing':
      let listing = path.join(__dirname, 'listing.csv')
      fs.unlink(listing, err => { if (err) console.log(err) })
      fs.rename(job.localPath, listing)
  }
  delete jobs[job.jobId]
  fs.writeFile(jobFile, JSON.stringify(jobs))
}

function initiateUpload(job) {
  console.log('initiating Glacier upload')
  job.status = 1
  var params = { vaultName: job.vaultName, archiveDescription: job.name }
  if (job.bytes < chunkSize) { // single part upload
    console.log('selecting single part upload')
    var buffer = fs.readFileSync(job.filename)
    params.body = buffer
    glacier.uploadArchive(params, (err, data) => {
      completeUpload(job, err, data)
    })
    jobs[job.jobId] = job
    fs.writeFile(jobFile, JSON.stringify(jobs))
  } else {                     // multipart upload
    console.log('selecting multipart upload')
    job.pieces = Math.trunc(job.bytes / chunkSize) + (job.bytes % chunkSize == 0 ? 0 : 1)
    params.partSize = chunkSize.toString()

    // AWS's implementation of treehash is limited by the max buffer size (~2GB)
    // so we will use a module capable of calculating a tree hash from a stream
    var hashStream = treehash.createTreeHashStream(),
        fileStream = fs.createReadStream(job.filename)
    fileStream.on('data', chunk => { hashStream.update(chunk) })
    fileStream.on('end', () => {
      job.treeHash = hashStream.digest()
      glacier.initiateMultipartUpload(params, (err, data) => {
        if (err) console.log('err: ', err)
        console.log('multipart upload initiated with uploadId', data.uploadId)
        job.uploadId = data.uploadId
        job.currentChunkIndex = 0
        uploadChunk(job, 0)
      })
    })
  }
}

function uploadChunk(job, chunkIndex) {
  console.log('uploading chunk ' + (chunkIndex + 1) + ' of ' + job.pieces)
  var offset = chunkIndex * chunkSize
  var length = chunkIndex == job.pieces - 1 ? job.bytes % chunkSize : chunkSize
  var end = offset + length - 1
  console.log(`chunk stats | start: ${offset} | length: ${length} | end: ${end}`)
  var buffer = Buffer.alloc(length)
  fs.open(job.filename, 'r', (err, fd) => {
    if (err) console.log(err)
    fs.read(fd, buffer, 0, length, offset, () => {
      console.log('chunk read, preparing to upload')
      var params = { vaultName: job.vaultName, uploadId: job.uploadId, body: buffer, range: `bytes ${offset}-${end}/*` }
      glacier.uploadMultipartPart(params, (err, data) => {
        if (err) {
          console.log('chunk ' + (chunkIndex + 1) + ' failed to upload (' + err.message + '), trying again')
          uploadChunk(job, chunkIndex)
        } else {
          if (chunkIndex == job.pieces - 1) { // complete upload
            console.log('chunk ' + (chunkIndex + 1) + ' uploaded successfully, completing upload')
            fs.close(fd)          
            delete params.body
            delete params.range
            params.archiveSize = job.bytes.toString()
            params.checksum = job.treeHash
            glacier.completeMultipartUpload(params, (err, data) => {
              completeUpload(job, err, data)
            })
          } else {
            console.log('chunk ' + (chunkIndex + 1) + ' uploaded successfully, beginning next chunk')
            job.currentChunkIndex = chunkIndex + 1
            uploadChunk(job, chunkIndex + 1)  // continue upload with next chunk
          }
        }
      })
    })
  })
  jobs[job.jobId] = job
  fs.writeFile(jobFile, JSON.stringify(jobs))
}

function completeUpload(job, err, data) {
  console.log('upload complete')
  if (err) console.log('Error uploading archive!', err)
    else {
      console.log('Archive ID', data.archiveId)
      var filename = job.filename
      delete jobs[job.jobId]
      delete job.type
      delete job.status
      delete job.filename
      delete job.pieces
      delete job.currentChunkIndex
      delete job.vaultName
      delete job.jobId
      delete job.treeHash
      job.date = new Date()
      job.id = data.archiveId
      var backup = new Backup(job)
      backup.save(() => {
        console.log('Archive logged to DB')
        fs.writeFile(jobFile, JSON.stringify(jobs), () => {
          console.log('Job listing updated')
        })
        fs.unlink(filename)
      })
    }
}

function archiveDir(job, callback) {
  // create a file to stream archive data to. 
  var result = path.join(__dirname, 'uploads', 'archive-' + job.jobId + '.tar.gz')
  var output = fs.createWriteStream(result)
  var archive = archiver('tar', {
    gzip: true,
    gzipOptions: { level: 9 } // Sets the compression level. 
  })
  
  output.on('close', () => {
    console.log(archive.pointer() + ' total bytes')
    console.log('archiver has been finalized and the output file descriptor has closed.')
    delete job.archiverTotalSize
    delete job.archiverSizeProgress
    delete job.archiverTotalFiles
    delete job.archiverFilesProgress
    job.filename = result
    job.bytes = archive.pointer()
    fs.writeFile(jobFile, JSON.stringify(jobs))
    callback(job)
  })

  archive.on('progress', (prog) => {
    job.archiverTotalSize = prog.fs.totalBytes
    job.archiverSizeProgress = prog.fs.processedBytes
    job.archiverTotalFiles = prog.entries.total
    job.archiverFilesProgress = prog.entries.processed
    fs.writeFile(jobFile, JSON.stringify(jobs))
    //console.log(`total: ${prog.entries.total} | processed: ${prog.entries.processed} | size: ${prog.fs.totalBytes}`)
  })
  
  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
        // log warning 
    } else {
        // throw error 
        console.log(err)
    }
  })
  
  archive.on('error', (err) => {
    console.log(err)
  })

  archive.glob('**/*', {
    cwd: job.path,
    ignore: ['*.pst', 'html/main/inventory/img/2j8fj/4h4h94/*']
  })
  
  archive.pipe(output);  
  archive.finalize()
}

function parseLog(filename, callback, options) {
  var count = 0
  var shouldEnd = false
  var endingIP = 0
  if (options === undefined) var options = {}
  if (options.offset === undefined) options.offset = 0
  if (options.limit === undefined) options.limit = limit
  var offset = options.offset
  var lr = new LineByLineReader(filename, {
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
    if (line == '') return
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
