'use babel';

import Pyboard from './board/pyboard';
import Pymakr from './pymakr';
import PanelView from './main/panel-view';
import { CompositeDisposable } from 'atom';
import Config from './config.js'
import SettingsWrapper from './main/settings-wrapper';

export default {
  config: Config.settings(),

  activate(state) {
    this.settings = new SettingsWrapper()
    this.pyboard = new Pyboard(this.settings)
    this.view = new PanelView(this.pyboard,this.settings)
    this.pymakr = new Pymakr(state.viewState,this.pyboard,this.view,this.settings)

    this.pymakr.addPanel()

    // Events subscribed to in atom's system can be easily cleaned up with a CompositeDisposable
    this.subscriptions = new CompositeDisposable();

    // Register command that toggles this view
    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'pymakr:sync': () => this.pymakr.sync(),
      'pymakr:upload': () => this.pymakr.upload(),
      'pymakr:toggleREPL': () => this.pymakr.toggleVisibility(),
      'pymakr:connect': () => this.pymakr.connect(),
      'pymakr:run': () => this.pymakr.run(),
      'pymakr:help': () => this.pymakr.writeHelpText(),
      'pymakr:clearTerminal': () => this.pymakr.clearTerminal(),
      'pymakr:disconnect': () => this.pymakr.disconnect()
    }));
  },

  deactivate() {
    this.subscriptions.dispose();
    this.pymakr.destroy();
  },

  serialize() {
    return {
      viewState: this.pymakr.serialize()
    };
  },

}
