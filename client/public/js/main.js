var jobs = {}
$('.backup-now').on('click', function(e) {
  e.preventDefault()
  var target = $(this).attr('data-dir')
  var desc = $(this).attr('data-desc')
  if (!jobs[target]) {
    jobs[target] = true
    $.ajax({
      method: 'put',
      url: 'backups',
      data: 'desc=' + desc + '&path=' + target + '&key=#APIKEY#',
      success: function(response) {
        notify(response.message)
      }
    })
  } else {
    notify('That backup is already in progress.', 'warning')
  }
})

$('.delete-now').on('click', function() {
  if (confirm('Are you sure you want to delete this archive? (This action cannot be undone.)')) {
    $.ajax({
      method: 'delete',
      url: 'backups',
      data: 'archive=' + $(this).attr('data-archive') + '&key=#APIKEY#',
      success: function(response) {
        notify(response.message)
      }
    })
  } else {
    notify('Deletion cancelled.', 'error', 2000)
  }
})

$('.retrieve-now').on('click', function() {
  if (confirm('Are you sure you would like to initiate retrieval of this archive? This process generally takes between 3 and 5 hours to prepare, in addition to however much time is required to download the archive.')) {
    $.post({
      url: 'backups',
      data: 'archive=' + $(this).attr('data-archive') + '&key=#APIKEY#',
      success: function(response) {
        notify(response.message)
      }
    })
  }
})

$('.download-now').on('click', function() {
  $.post({
    url: 'download',
    data: 'jobId=' + $(this).attr('data-job') + '&key=#APIKEY#',
    success: function(response) {
      notify(response.message, 'focus')
    }
  })
})

function notify(message, _style, _duration) {
  var $msg = $('#site-message'),
      style = _style || 'black',
      duration = _duration || 6000
  $msg.addClass(style).text(message).fadeIn()
  setTimeout(function() {
    $msg.removeClass(style).fadeOut()
  }, duration)
}