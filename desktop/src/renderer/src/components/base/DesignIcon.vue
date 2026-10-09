<script setup lang="ts">
import { computed } from 'vue'
import overview from '../../assets/design/overview.svg'
import sessions from '../../assets/design/sessions.svg'
import quota from '../../assets/design/quota.svg'
import analytics from '../../assets/design/analytics.svg'
import plans from '../../assets/design/plans.svg'
import insight from '../../assets/design/insight.svg'
import agents from '../../assets/design/agents.svg'
import settings from '../../assets/design/settings.svg'
import person from '../../assets/design/person.svg'
import globe from '../../assets/design/globe.svg'
import replay from '../../assets/design/replay.svg'
import externalLink from '../../assets/design/external-link.svg'
import chevronRight from '../../assets/design/chevron-right.svg'
import megaphone from '../../assets/design/megaphone.svg'
import rocket from '../../assets/design/rocket.svg'
import update from '../../assets/design/update.svg'
import download from '../../assets/design/download.svg'
import circleCheck from '../../assets/design/circle-check.svg'
import logout from '../../assets/design/logout.svg'
import login from '../../assets/design/login.svg'
import check from '../../assets/design/check.svg'
import capabilityBook from '../../assets/design/capability-book.svg'
import capabilityCode from '../../assets/design/capability-code.svg'
import capabilityFile from '../../assets/design/capability-file.svg'
import capabilityBox from '../../assets/design/capability-box.svg'
import settingsBack from '../../assets/design/settings-back.svg'
import settingsGeneral from '../../assets/design/settings-general.svg'
import settingsAppearance from '../../assets/design/settings-appearance.svg'
import settingsLogs from '../../assets/design/settings-logs.svg'
import settingsFeedback from '../../assets/design/settings-feedback.svg'
import settingsAbout from '../../assets/design/settings-about.svg'
import behaviorAsk from '../../assets/design/behavior-ask.svg'
import behaviorBackground from '../../assets/design/behavior-background.svg'
import behaviorQuit from '../../assets/design/behavior-quit.svg'
import networkRefresh from '../../assets/design/network-refresh.svg'
import networkMinus from '../../assets/design/network-minus.svg'
import networkInfo from '../../assets/design/network-info.svg'
import networkPin from '../../assets/design/network-pin.svg'
import networkEye from '../../assets/design/network-eye.svg'
import networkServer from '../../assets/design/network-server.svg'
import networkArrow from '../../assets/design/network-arrow.svg'
import networkDns from '../../assets/design/network-dns.svg'
import networkX from '../../assets/design/network-x.svg'
import floatingPin from '../../assets/design/floating-pin.svg'
import floatingPinOutline from '../../assets/design/floating-pin-outline.svg'
import floatingMore from '../../assets/design/floating-more.svg'
import floatingClose from '../../assets/design/floating-close.svg'
import floatingArrow from '../../assets/design/floating-arrow.svg'
import floatingRefresh from '../../assets/design/floating-refresh.svg'
const icons = {
  overview,
  sessions,
  quota,
  analytics,
  plans,
  insight,
  agents,
  settings,
  person,
  globe,
  replay,
  externalLink,
  chevronRight,
  megaphone,
  rocket,
  update,
  download,
  circleCheck,
  logout,
  login,
  check,
  capabilityBook,
  capabilityCode,
  capabilityFile,
  capabilityBox,
  settingsBack,
  settingsGeneral,
  settingsAppearance,
  settingsLogs,
  settingsFeedback,
  settingsAbout,
  behaviorAsk,
  behaviorBackground,
  behaviorQuit,
  networkRefresh,
  networkMinus,
  networkInfo,
  networkPin,
  networkEye,
  networkServer,
  networkArrow,
  networkDns,
  networkX,
  floatingPin,
  floatingPinOutline,
  floatingMore,
  floatingClose,
  floatingArrow,
  floatingRefresh,
}
const props = withDefaults(defineProps<{ name: keyof typeof icons; size?: number }>(), { size: 20 })
const mask = computed(() => `url("${icons[props.name]}")`)
</script>
<template>
  <span
    class="design-icon"
    aria-hidden="true"
    :style="{ width: `${size}px`, height: `${size}px`, maskImage: mask }"
  />
</template>
<style scoped>
.design-icon {
  display: inline-block;
  flex: 0 0 auto;
  background: currentColor;
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
}
</style>
