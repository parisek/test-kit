<script setup>
import { computed } from 'vue';
import { headerLine } from '../../../src/report/scope.js';
// DESIGN.md "Scope line" (#287 option C, #290): one line in the report header. It holds the scope sentence
// and the "not compared" sentence. A report with neither renders nothing, not even an empty element.
const props = defineProps({ report: Object });
const line = computed(() => headerLine(props.report));
</script>
<template>
    <p v-if="line" class="report-scope" data-testid="scope-line">{{ line }}</p>
</template>
