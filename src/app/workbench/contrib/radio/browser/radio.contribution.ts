import { registerView } from '@app/workbench/common/views'
import { RADIO_DIRECTORY_VIEW_ID, createRadioDirectoryView } from './radioDirectoryView'
import { RADIO_LISTEN_VIEW_ID, createRadioListenView } from './radioListenView'

registerView({
  id: RADIO_LISTEN_VIEW_ID,
  titleKey: 'radio.navListen',
  iconId: 'radio-tower',
  order: 10,
  defaultLocation: 'sidebar',
  factory: () => createRadioListenView,
})

registerView({
  id: RADIO_DIRECTORY_VIEW_ID,
  titleKey: 'radio.navDirectory',
  iconId: 'broadcast',
  order: 20,
  defaultLocation: 'auxiliarybar',
  factory: () => createRadioDirectoryView,
})
