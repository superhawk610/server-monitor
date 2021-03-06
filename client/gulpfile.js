const gulp = require('gulp')

gulp.task('kube', () => {
  gulp.src('../node_modules/imperavi-kube/dist/css/kube.min.css')
      .pipe(gulp.dest('public/css'))
  gulp.src('../node_modules/imperavi-kube/dist/scss/kube.scss')
      .pipe(gulp.dest('build/scss'))
  gulp.src('../node_modules/imperavi-kube/dist/js/kube.min.js')
      .pipe(gulp.dest('public/js'))
})

gulp.task('jquery', () => {
  return gulp.src('../node_modules/jquery/dist/jquery.min.js')
             .pipe(gulp.dest('public/js'))
})

gulp.task('tooltipster', () => {
  gulp.src(['../node_modules/tooltipster/dist/css/tooltipster.bundle.min.css',
            '../node_modules/tooltipster/dist/css/plugins/tooltipster/sideTip/**/*'])
      .pipe(gulp.dest('public/css'))
  gulp.src('../node_modules/tooltipster/dist/js/tooltipster.bundle.min.js')
      .pipe(gulp.dest('public/js'))
})

gulp.task('font-awesome', () => {
  gulp.src('../node_modules/font-awesome/fonts/*')
      .pipe(gulp.dest('public/fonts'))
  gulp.src('../node_modules/font-awesome/css/font-awesome.min.css')
      .pipe(gulp.dest('public/css'))
})

gulp.task('default', [ 'kube', 'jquery', 'tooltipster', 'font-awesome' ])
