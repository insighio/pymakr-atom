'use babel';

import Pyboard from './board/pyboard';
import Sync from './board/sync';
import Runner from './board/runner';
import Term from './main/terminal';
import PySerial from './connections/pyserial';
import ApiWrapper from './main/api-wrapper.js';
import Logger from './helpers/logger.js'
import PanelView from './main/panel-view.js'
import Config from './config.js'
var EventEmitter = require('events');

var fs = require('fs');
var ElementResize = require("element-resize-detector");

export default class Pymakr extends EventEmitter {

  constructor(serializedState,pyboard,view,settings) {
    super()
    var _this = this
    this.pyboard = pyboard
    this.synchronizing = false
    this.synchronize_type = ""
    this.settings = settings
    this.api = new ApiWrapper(settings)
    this.logger = new Logger('Pymakr')
    this.config = Config.constants()
    this.view = view
    this.autoconnect_timer = null
    this.autoconnect_address = undefined
    this.connection_timer = null

    this.first_time_start = !this.api.settingsExist()

    this.terminal = this.view.terminal
    this.runner = new Runner(pyboard,this.terminal,this)

    this.settings.on('format_error',function(){
      _this.terminal.writeln("JSON format error in pymakr.conf file")
      if(_this.pyboard.connected){
        _this.terminal.writePrompt()
      }
    })

    this.view.on('term-connected',function(){
      _this.logger.info("Connected trigger from view")
      if(_this.settings.open_on_start){
        _this.connect()
      }
    })

    this.view.on('connect',function(){
      this.logger.verbose("Connect emitted")
      _this.connect()
      _this.setButtonState()
    })

    this.view.on('disconnect',function(){
      this.logger.verbose("Disconnect emitted")
      _this.disconnect()
      _this.setButtonState()
    })

    this.view.on('close',function(){
      this.logger.verbose("Close emitted")
      _this.disconnect()
      _this.setButtonState()
      _this.stopAutoConnect()
    })

    this.view.on('open',function(){
      this.logger.verbose("Open emitted")
      _this.startAutoConnect(function(connected_on_addr){
        if(!connected_on_addr){
          _this.logger.verbose("No address from autoconnect, connecting normally")
          _this.connect()
        }
        _this.setButtonState()
      })

    })

    this.view.on('run',function(){
      if(!_this.synchronizing){
        _this.run()
      }
    })

    this.view.on('sync',function(){
      if(!_this.synchronizing){
        _this.upload()
      }else{
        _this.stopSync()
      }
      _this.setButtonState()
    })

    this.view.on('sync_receive',function(){
      if(!_this.synchronizing){
        _this.download()
      }else{
        _this.stopSync()
      }
      _this.setButtonState()
    })

    this.view.on('global_settings',function(){
      _this.api.openSettings()
    })

    this.view.on('project_settings',function(){
      _this.openProjectSettings()
    })

    this.view.on('get_version',function(){
      _this.getVersion()
    })

    this.view.on('get_serial',function(){
      _this.getSerial()
    })

    this.view.on('get_wifi',function(){
      _this.getWifiMac()
    })
    this.view.on('help',function(){
      _this.writeHelpText()
    })

    this.view.on('terminal_click',function(){
      this.logger.verbose("Terminal click emitted")
      if(!_this.pyboard.connected && !_this.pyboard.connecting) {
        _this.logger.verbose("Connecting because of terminal click")
        _this.connect()
      }
    })

    this.view.on('user_input',function(input){
      var _this = this
      // this.terminal.write('\r\n')
      this.pyboard.send_user_input(input,function(err){
        if(err && err.message == 'timeout'){
          _this.logger.warning("User input timeout, disconnecting")
          _this.logger.warning(err)
          _this.disconnect()
        }
      })
    })

    this.on('auto_connect',function(address){
      if(!_this.pyboard.connecting){
        _this.logger.verbose("Autoconnect event, disconnecting and connecting again")
        _this.connect(address)
      }
    })

    this.pyboard.registerStatusListener(function(status){
      if(status == 3){
        _this.terminal.enter()
      }
    })

    this.api.listenToProjectChange(function(path){
      var address = _this.settings.address
      _this.view.setProjectName(path)
      _this.settings.projectChanged()
      if(address != _this.settings.address){
        _this.logger.verbose("Project changed, address changed, therefor connecting again:")
        _this.connect()
      }
    })

    // hide panel if it was hidden after last shutdown of atom
    var close_terminal = serializedState && 'visible' in serializedState && !serializedState.visible

    if(!this.settings.open_on_start || close_terminal){
      this.hidePanel()
    }else if(serializedState && 'visible' in serializedState && _this.view.visible) {
      if(this.settings.auto_connect){
        this.startAutoConnect()
      }else{
        _this.logger.verbose("No auto connect enabled, connecting normally:")
        this.connect()
      }
    }

    this.settings.onChange('auto_connect',function(old_value,new_value){
      var v = new_value
      _this.logger.info("auto_connect setting changed to "+v)
      if(v && _this.view.visible){
        _this.startAutoConnect()
      }else{
        _this.stopAutoConnect()
        _this.connect()
      }
    })
  }

  startAutoConnect(cb){
    if(this.view.visible){
      var _this = this
      this.logger.info("Starting autoconnect interval...")
      this.stopAutoConnect()
      this.setAutoconnectAddress(cb)
      this.autoconnect_timer = setInterval(function(){
        _this.setAutoconnectAddress()
      },2500)
    }else{
      cb(null)
    }
  }

  stopAutoConnect(){
    var previous = this.pyboard.address
    if(this.autoconnect_timer){
      this.logger.info("Stop autoconnect")
      clearInterval(this.autoconnect_timer)
      previous = this.autoconnect_address
      this.autoconnect_address = undefined
    }
    if(previous != this.settings.address && (this.pyboard.connected || this.pyboard.connecting)){
      this.logger.info("Disconnecting from previous autoconnect address")
      this.disconnect()
    }
  }

  setAutoconnectAddress(cb){
    var _this = this
    var emitted_addr = null
    this.getAutoconnectAddress(function(address){
      _this.logger.silly("Found address: "+address)
      if(_this.autoconnect_address === undefined && !address){ // undefined means first time use
        _this.terminal.writeln("Autoconnect: No PyCom boards found on USB")
      }else if(address && address != _this.autoconnect_address){
        _this.terminal.writeln("Autoconnect: Found a PyCom board on USB")
        emitted_addr = address
        _this.emit('auto_connect',address)
      }else if(_this.autoconnect_address && !address){
        _this.autoconnect_address = null
        _this.disconnect()
        _this.terminal.writeln("Autoconnect: Previous board is not available anymore")
        _this.logger.silly("Autoconnect: Previous board is not available anymore")
      }else if(!address){
        _this.logger.silly("No address found")
      }else{
        _this.logger.silly("Ignoring address "+address+" for now")
      }
      if(cb){
        cb(emitted_addr)
      }
      _this.autoconnect_address = address
    })
  }

  getAutoconnectAddress(cb){
    var _this = this
    _this.logger.silly("Autoconnect interval")
    if(this.settings.auto_connect){
      _this.logger.silly("Autoconnect enabled")
      this.getPycomBoard(function(name,manu,list){
        var current_address = _this.pyboard.address
        if(name){
          var text = name + " (" + manu+ ")"
          if(!_this.pyboard.connected){
            cb(name)
          }else{
            if(name != _this.pyboard.address){
              if(list.indexOf(current_address) > -1 || !_this.pyboard.isSerial){
                cb(name)
              }else{
                _this.logger.silly("already connected to a different board, or connected over telnet")
                cb(null)
              }
            }else{
              _this.logger.silly("already connected to the correct board")
              cb(name)
            }
          }
        }else{
          cb(null)
          _this.logger.silly("No Pycom boards found")
        }
      })
    }
  }

  getPycomBoard(cb){
    var _this = this
    PySerial.listPycom(function(list,manufacturers){
      var current_address = _this.pyboard.address
      if(list.length > 0){
        var name = list[0]
        var manu = manufacturers[0]
        var text = name + " (" + manu+ ")"
        cb(name,manu,list)
      }else{
        cb(null,null,list)
      }
    })
  }

  openProjectSettings(){
    var _this = this
    this.settings.openProjectSettings(function(err){
      if(err){
        _this.terminal.writeln(err.message)
        if(_this.pyboard.connected){
          _this.terminal.writePrompt()
        }
      }
    })
  }

  openGlobalSettings(){
    this.api.openSettings(function(){
      // nothing
    })
  }

  getWifiMac(){
    var _this = this
    if(!this.pyboard.connected){
      this.terminal.writeln("Please connect to your device")
      return
    }

    var command = "from network import WLAN; from binascii import hexlify; from os import uname; wlan = WLAN(); mac = hexlify(wlan.mac()).decode('ascii'); device = uname().sysname;print('WiFi AP SSID: %(device)s-wlan-%(mac)s' % {'device': device, 'mac': mac[len(mac)-4:len(mac)]})"
    _this.pyboard.send_wait_for_blocking(command+'\n\r',command,function(err){
      if(err){
        _this.logger.error("Failed to send command: "+command)
      }
    },1000)
  }

  getSerial(){
    var _this = this
    this.terminal.enter()

    PySerial.list(function(list,manufacturers){
      _this.terminal.writeln("Found "+list.length+" serialport"+(list.length == 1 ? "" : "s"))
      for(var i=0;i<list.length;i++){
        var name = list[i]
        var text = name + " (" + manufacturers[i]+ ")"
        if(i==0){
          _this.api.writeToCipboard(name)
          text += " (copied to clipboard)"
        }

        _this.terminal.writeln(text)
      }
    })
  }

  getVersion(){
    var _this = this
    if(!this.pyboard.connected){
      this.terminal.writeln("Please connect to your device")
      return
    }
    var command = "import os; os.uname().release\r\n"
    this.pyboard.send_wait_for_blocking(command,command,function(err){
      if(err){
        _this.logger.error("Failed to send command: "+command)
      }
    })
  }

  // refresh button display based on current status
  setButtonState(){
    this.view.setButtonState(this.runner.busy,this.synchronizing,this.synchronize_type)
  }

  setTitle(status){
	  this.view.setTitle()
  }

  connect(address){
    var _this = this
    this.logger.info("Connecting...")
    this.logger.info(address)


    if(this.first_time_start){
      this.first_time_start = false
      _this.api.openSettings()
      _this.writeGetStartedText()
    }

    if(!address && this.autoconnect_address){
      address = this.autoconnect_address
      this.logger.info("Using autoconnect address: "+address)
    }

    // this.api.getConnectionState(address)
    var state = this.api.getConnectionState(address)
    var ts = new Date().getTime()
    if(state && state['project'] != this.view.project_name && state['timestamp'] > ts-11000){
      this.terminal.writeln("Already connected in another window (project '"+state['project']+"')")
      return
    }

    var continueConnect = function(){
      // stop config observer from triggering again
      if(_this.pyboard.connected || _this.pyboard.connecting){
        _this.logger.info("Still connected or connecting... disconnecting first")
        _this.disconnect(function(){
          _this.continueConnect()
        })
      }else{
        _this.continueConnect()
      }
    }

    if(!address && _this.settings.auto_connect){
      this.getAutoconnectAddress(function(address,manu){
        _this.pyboard.setAddress(address)
        continueConnect()
      })
    }else{
      if(address){
        _this.pyboard.setAddress(address)
      }
      continueConnect()
    }
  }

  continueConnect(){
    var _this = this
    this.pyboard.refreshConfig()
    var address = this.pyboard.address
    var connect_preamble = ""

    if(address == "" || address == null){
      if(!this.settings.auto_connect){
        this.terminal.writeln("Address not configured. Please go to the settings to configure a valid address or comport")
      }
    }else{
      if(this.settings.auto_connect){
        connect_preamble = "Autoconnect: "
      }
      this.terminal.writeln(connect_preamble+"Connecting on "+address+"...");

      var onconnect = function(err){
        if(err){
          _this.terminal.writeln("Connection error: "+err)
        }else{
          _this.api.setConnectionState(address,true,_this.view.project_name)
          _this.connection_timer = setInterval(function(){
            if(_this.pyboard.connected){
              _this.api.setConnectionState(address,true,_this.view.project_name)
            }else{
              clearTimeout(_this.connection_timer)
            }
          },10000)
        }

        _this.setButtonState()
      }

      var onerror = function(err){
        var message = _this.pyboard.getErrorMessage(err.message)
        if(message == ""){
          message = err.message ? err.message : "Unknown error"
        }
        if(_this.pyboard.connected){
          _this.logger.warning("An error occurred: "+message)
          if(_this.synchronizing){
            _this.terminal.writeln("An error occurred: "+message)
            _this.logger.warning("Synchronizing, stopping sync")
            _this.syncObj.stop()
          }
        }else{
          _this.terminal.writeln("> Failed to connect ("+message+"). Click here to try again.")
          _this.setButtonState()
        }
      }

      var ontimeout = function(err){
        _this.terminal.writeln("> Connection timed out. Click here to try again.")
        _this.setButtonState()
      }

      var onmessage = function(mssg){
        if(!_this.synchronizing){
          _this.terminal.write(mssg)
        }
      }

      _this.pyboard.connect(address,onconnect,onerror, ontimeout, onmessage)
    }
  }

  disconnect(cb){
    var _this = this
    this.logger.info("Disconnecting...")
    if(this.pyboard.isConnecting()){
        this.terminal.writeln("Connection attempt canceled")
    }
    // else{
    //   this.terminal.writeln("Disconnected. Click here to reconnect.")
    // }
    clearInterval(this.connection_timer)
    _this.api.setConnectionState(_this.pyboard.address,false)
    this.pyboard.disconnect(function(){
      if(cb) cb()
    })
    this.synchronizing = false
    this.runner.stop()
    this.setButtonState()

  }

  run(){
    var _this = this
    if(!this.pyboard.connected){
      this.terminal.writeln("Please connect your device")
      return
    }
    if(!this.synchronizing){
      this.runner.toggle(function(){
        _this.setButtonState()
      })
    }
  }

  upload(){
    this.sync()
  }

  download(){
    this.sync('receive')
  }

  sync(type){
    this.logger.info("Sync")
    this.logger.info(type)
    var _this = this
    if(!this.pyboard.connected){
      this.terminal.writeln("Please connect your device")
      return
    }
    if(!this.synchronizing){
      this.syncObj = new Sync(this.pyboard,this.settings,this.terminal)
      this.synchronizing = true
      this.synchronize_type = type
      var cb = function(err){

        _this.synchronizing = false
        _this.setButtonState()
        if(_this.pyboard.type != 'serial'){
          setTimeout(function(){
              _this.connect()
          },4000)
        }
      }
      if(type == 'receive'){
        this.syncObj.start_receive(cb)
      }else{
        this.syncObj.start(cb)
      }
    }
  }

  stopSync(){
    if(this.synchronizing){
      this.syncObj.stop()
      var type = this.synchronize_type == 'receive' ? 'download' : 'upload'
      this.terminal.writeln("Stopping "+type+", waiting for last action to finish...")
    }
  }


  writeHelpText(){
    var lines = []

    this.terminal.enter()
    this.terminal.write(this.config.help_text)

    if(this.pyboard.connected){
      this.logger.verbose("Write prompt")
      this.terminal.writePrompt()
    }
  }

  // VSCode only
  writeGetStartedText(){
    var _this = this
    this.terminal.enter()
    this.terminal.write(this.config.start_text)

    Pyserial.list(function(list){
      if(list.length > 0){
        _this.terminal.writeln("Here are the devices you've connected to the serial port at the moment:")
        _this.getSerial()
      }else if(this.pyboard.connected){
        this.terminal.writeln()
        this.terminal.writePrompt()
      }
    })


  }

  // UI Stuff
  addPanel(){
    this.view.addPanel()
  }

  hidePanel(){
    this.view.hidePanel()
    this.logger.verbose("Hiding pannel + disconnect")
    this.disconnect()
  }

  showPanel(){
    this.view.showPanel()
    this.setButtonState()
    this.connect()
  }


  clearTerminal(){
    this.view.clearTerminal()
  }

  toggleVisibility(){
    this.view.visible ? this.hidePanel() : this.showPanel();
  }
  // VSCode only
  toggleConnect(){
    this.pyboard.connected ? this.disconnect() : this.connect();
  }


  // Returns an object that can be retrieved when package is activated
  serialize() {
    return {visible: this.view.visible}
  }

  // Tear down any state and detach
  destroy() {
    this.logger.warning("Destroying plugin")
    this.disconnect()
    this.view.removeElement()
  }

  getElement() {
    return this.view.element;
  }

}
