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

gulp.task('default', [ 'kube', 'jquery' ])
