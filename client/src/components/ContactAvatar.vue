<script setup lang="ts">
import type { Contact } from '@yourdav/shared'
import { computed, ref, watch } from 'vue'
import { api } from '../api.js'
import { initials } from '../lib/labels.js'

// The root element is either an <img> (contact has a photo) or a <div> with
// the initials; the parent supplies the size/shape/colour through `class`,
// which falls through to whichever root renders.
const props = defineProps<{ contact: Contact; previewSrc?: string | null }>()

const failed = ref(false)
watch(
  () => props.contact.etag,
  () => (failed.value = false),
)

const src = computed(() => {
  if (props.previewSrc) return props.previewSrc
  if (!props.contact.hasPhoto || failed.value) return null
  return api.photoUrl(props.contact.addressBookId, props.contact.href, props.contact.etag)
})
</script>

<template>
  <img v-if="src" class="avatar-photo" :src="src" alt="" @error="failed = true" />
  <div v-else>{{ initials(contact.fullName) }}</div>
</template>

<style scoped>
.avatar-photo {
  object-fit: cover;
}
</style>
