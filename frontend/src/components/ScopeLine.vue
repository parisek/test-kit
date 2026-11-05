<script setup>
import { computed } from 'vue';
import { reportScope, scopeLine } from '../../../src/report/scope.js';
// DESIGN.md "Scope line" (#287, owner decision option C): one line in the report header.
// A report without meta.scope renders nothing, not even an empty element.
const props = defineProps({ report: Object });
const scope = computed(() => reportScope(props.report));
</script>
<template>
    <p v-if="scope" class="report-scope" data-testid="scope-line">{{ scopeLine(scope) }}</p>
</template>
