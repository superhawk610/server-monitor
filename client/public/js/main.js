var jobs = {}
$('.backup-now').on('click', function(e) {
  e.preventDefault()
  var target = $(this).attr('data-dir')
  if (!jobs[target]) {
    jobs[target] = true
    $.ajax({
      method: 'put',
      url: 'backups',
      data: 'path=' + target + '&key=#APIKEY#',
      success: function(response) {
        notify(response.message, 'primary')
      }
    })
  } else {
    notify('That backup is already in progress.')
  }
})

function notify(message, _style, _duration) {
  var $msg = $('#site-message'),
      style = _style || 'warning',
      duration = _duration || 6000
  $msg.addClass(_style).text(message).fadeIn()
  setTimeout(function() {
    $msg.removeClass(_style).fadeOut()
  }, duration)
}