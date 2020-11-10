<template>
  <component :is='component' v-bind='propsAndAttrs' v-if="authorized">
    <slot></slot>
  </component>
  <div v-else-if="!resolved">Error during resolving
    <pre>{{ to }}</pre>
  </div>
</template>

<script>
import { getAuthorizationFromRoute } from '../route'

export default {
  name: 'authorized-link',
  props: ['component', 'to'],
  computed: {
    propsAndAttrs() {
      return {
        ...this.$props,
        ...this.$attrs
      }
    },
    resolved() {
      return this.$router.resolve(this.to)
    },
    authorized() {
      if (!this.resolved) {
        return false
      }
      const routeAuthorization = getAuthorizationFromRoute(this.resolved.route)
      if (!routeAuthorization) {
        return true
      }
      return this.$auth.isAuthorized(
          this.$auth.state.value,
          routeAuthorization.needsRequired,
          this.$auth.state.value.needsProvided,
          {
            route: this.resolved.route
          }
      )
    }
  }
}
</script>
