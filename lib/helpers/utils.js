'use babel';
import Config from '../config.js'

// Import this class and create a new logger object in the constructor, providing
// the class name. Use the logger anywhere in the code
// this.logger = new Logger('Pyboard')
// this.logger.warning("Syncing to outdated firmware")
// Result in the console will be:
// [warning] Pyboard | Syncing to outdated firmware

export default class Utils {

  // runs a worker recursively untill a task is Done
  // worker should take 2 params: value and a continuation callback
    // continuation callback takes 2 params: error and the processed value
  // calls 'end' whenever the processed_value comes back empty/null or when an error is thrown
  doRecursively(value,worker,end){
    var _this = this
    worker(value,function(err,value_processed,done){

        if(err){
          end(err)
        }else if(done){
          end(null,value_processed)
        }else{
          _this.doRecursively(value_processed,worker,end)

        }
    })
  }

  base64decode(b64str){
    var content = ""
    console.log(b64str)
    var b64str_arr = b64str.split('=')

    for(var i=0;i<b64str_arr.length;i++){
      var chunk = b64str_arr[i]
      if(chunk.length > 0){
        bc = Buffer.from(chunk+'=', 'base64').toString()
        content += bc
      }
    }

    b64str_total = b64str.replace(/=/g,'')
    console.log(b64str_total)
    bc = Buffer.from(b64str_total+'=', 'base64')
    console.log(bc.toString())

    return bc
  }

  plural(text,number){
    return text + (number == 1 ? "" : "s")
  }

  parse_error(content){
    err_index = content.indexOf("OSError:")
    if(err_index > -1){
      return Error(content.slice(err_index,content.length-2))
    }else{
      return null
    }
  }


  calculate_int_version(version){
    var known_types = ['a', 'b', 'rc', 'r']
    if(!version){
      return 0
    }
    var version_parts = version.split(".")
    var dots = version_parts.length - 1
    if(dots == 2){
      version_parts.push('0')
    }

    for(var i=0;i<known_types.length;i++){
      var t = known_types[i]
      if(version_parts[3] && version_parts[3].indexOf(t)> -1){
        version_parts[3] = version_parts[3].replace(t,'')
      }
    }

    var version_string = ""

    for(var i=0;i<version_parts.length;i++){
      var val = version_parts[i]
      if(parseInt(val) < 10){
        version_parts[i] = '0'+val
      }
      version_string += version_parts[i]
    }
    return parseInt(version_string)
  }


  _was_file_not_existing(exception){
   error_list = ['ENOENT', 'ENODEV', 'EINVAL', 'OSError:']
   stre = exception.message
   for(var i=0;i<error_list.length;i++){
     if(stre.indexOf(error_list[i]) > -1){
       return true
     }
   }
   return false
  }

  int_16(int){
    var b = new Buffer(2)
    b.writeUInt16BE(int)
    return b
  }

  int_32(int){
    var b = new Buffer(4)
    b.writeUInt32BE(int)
    return b
  }
}
