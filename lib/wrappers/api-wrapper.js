'use babel';
const EventEmitter = require('events');
fs = require('fs');
$ = require('jquery')

export default class ApiWrapper {
  constructor(settings) {
    this.project_path = this.getProjectPath()
  }

  config(key){
    return atom.config.get("pymakr."+key)
  }

  setConfig(key,value){
    return atom.config.set("pymakr."+key,value)
  }

  openSettings(){
    atom.workspace.open("atom://config/packages/pymakr")
  }

  getConnectionState(com){
    var state = this.getConnectionStateContents()
    if(!state) return state
    return state[com]
  }

  getConnectionStateContents(){
    var folder = this.getPackagePath()
    try{
      return JSON.parse(fs.readFileSync(folder+'/connection_state.json'))
    }catch(e){
      console.log(e)
      // ignore and continue
      return {}
    }
  }

  setConnectionState(com,state,project_name){
    var folder = this.getPackagePath()
    var timestamp = new Date().getTime()
    var state_object = this.getConnectionStateContents()

    if(state){
      state_object[com] = {timestamp: timestamp, project: project_name}
    }else if(state_object[com]){
      delete state_object[com]
    }

    fs.writeFileSync(folder+'/connection_state.json', JSON.stringify(state_object))
  }

  onConfigChange(key,cb){
    atom.config.onDidChange("pymakr."+key,cb)
  }

  // only for consistency with VSC
  settingsExist(cb){
    return true
  }

  writeToCipboard(text){
    atom.clipboard.write(text)
  }

  addBottomPanel(options){
    atom.workspace.addBottomPanel(options)
  }

  getPackagePath(){
    return atom.packages.resolvePackagePath('pymakr')
  }

  getPackageSrcPath(){
    return this.getPackagePath() + "/lib/"
  }

  clipboard(){
    return atom.clipboard.read()
  }

  writeClipboard(text){
    atom.clipboard.write(text)
  }

  getProjectPaths(){
    return atom.project.getPaths()
  }

  onProjectsChange(cb){
    atom.project.onDidChangePaths(cb)
  }

  getOpenProjects(){
    var names = []
    var t = $('.tree-view li.project-root')
    for(var i = 0;i<t.length;i++){
      var li = t[i]
      names.push(li.getElementsByClassName('name')[0].dataset.name)
    }
    return names
  }

  listenToProjectChange(cb){
    var _this = this
    $('.tree-view').bind('DOMSubtreeModified', function(e) {
      var path = _this.getProjectPath()
      if(path != _this.project_path){
        _this.project_path = path
        cb(path)
      }
    });
  }

  confirm(title,text,options){
    atom.confirm(
      {
        message: title,
        detailedMessage: text,
        buttons: options
      }
    )
  }

  getIDEPath(){
    return atom.getConfigDirPath()
  }

  getProjectPath(){
    var project_paths = this.getProjectPaths()
    var selected_tree = $('.tree-view .selected')[0]
    var project
    if(selected_tree && typeof selected_tree.getPath !== "undefined"){
      var path = selected_tree.getPath()
      for(var i=0;i< project_paths.length;i++){
        if(path == project_paths[i]){
          return path
        }
      }
    }

    if(project_paths.length > 0){
      return project_paths[0]
    }
    return null
  }

  getSelected(){
    editor = atom.workspace.getActiveTextEditor() // Get the active editor object and also return immediately if something goes wrong and there's no active text editor.
    if(editor){
      selection = editor.getLastSelection() // Get the most recent selection.
      text = selection.getText() // A selection is an object with a bunch of information attached, so we need to get the text from it.
      if (text && text != ""){
        return text
      }
    }
    return ""

  }

  getSelectedOrLine(){
    var code = this.getSelected()

    if(!code){
      var editor = atom.workspace.getActiveTextEditor()
      var pos = editor.getCursorBufferPosition().row

      var code = editor.getTextInRange([[pos,0],[pos+1,0]]).replace(/\n$/, '') // remove trailing newline
    }
    return code
  }

  insertInOpenFile(code){
    var editor = atom.workspace.getActiveTextEditor()
    if(editor){
      editor.insertText(code.toString())
    }else{
      atom.notifications.addWarning("No file open to insert code into")
    }
  }

  notification(text,type){
    if(type=='warning'){
      atom.notifications.addWarning(text)
    }else if(type=='info'){
      atom.notifications.addInfo(text)
    }else if(type=='error'){
      atom.notifications.addError(text)
    }
  }

  error(text){
    this.notification(text,'error')
  }
  info(text){
    this.notification(text,'info')
  }
  warning(text){
    this.notification(text,'warning')
  }

  getOpenFile(cb,onerror){
    editor = atom.workspace.getActivePaneItem()

    if(editor && (editor.constructor.name == 'TextEditor' || editor.constructor.name == 'TextBuffer')){
      if(editor.isEmpty()){
        onerror("File is empty")
      }else{
        cb(editor.getText(),editor.getPath())
      }
    }else if (editor && editor.constructor.name == 'TreeView'){
      try{
        var contents = fs.readFileSync(editor.selectedPath)
        cb(contents,editor.selectedPath)
      }catch(e){
        onerror("Unable to run preview file")
      }


    }else{
      onerror("No file open to run")
    }
  }
}