import { type AppLocale, DEFAULT_APP_LOCALE } from '../localization'
import de from './de'
import en from './en'
import es from './es'
import fr from './fr'
import ja from './ja'
import ko from './ko'
import type { LocaleResource, RadioLocaleStrings } from './localeFactory'
import pt from './pt'
import ru from './ru'
import tr from './tr'
import zh from './zh'

export { type LocaleResource, TRAY_MENU_KEYS, type TrayMenuKey } from './localeFactory'

const englishRadio = en.radio as RadioLocaleStrings

const withRadioFallback = (resource: LocaleResource): LocaleResource =>
  resource.radio ? resource : { ...resource, radio: englishRadio }

export const LOCALE_RESOURCES: Record<AppLocale, LocaleResource> = {
  en,
  tr,
  de: withRadioFallback(de),
  fr: withRadioFallback(fr),
  pt: withRadioFallback(pt),
  zh: withRadioFallback(zh),
  es: withRadioFallback(es),
  ru: withRadioFallback(ru),
  ja: withRadioFallback(ja),
  ko: withRadioFallback(ko),
}

export const getLocaleResource = (locale: AppLocale): LocaleResource =>
  LOCALE_RESOURCES[locale] ?? LOCALE_RESOURCES[DEFAULT_APP_LOCALE]
