// 错误处理
var notify = require("gulp-notify")

module.exports = function(errorObject, callback) {
    // 错误通知
    notify.onError(errorObject.toString().split(': ').join(':\n'))
        .apply(this, arguments);
    
    // Keep gulp from hanging on this task
    if (typeof this.emit === 'function') {
        this.emit('end');
    }
}
