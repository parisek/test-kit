<script setup>
import { computed } from 'vue';
import { reportScope } from '../../../src/report/scope.js';
// The full lists behind the scope line. RunSummary places this inside "Run details" on Evidence.
// Where "Run details" is not a disclosure (the other views), `collapsible` wraps the lists in a closed one (#287).
const props = defineProps({ report: Object, collapsible: Boolean });
const scope = computed(() => reportScope(props.report));
// A selection holds `targets` and `viewports`; an absent axis selects all of it.
const describe = (selection, none) => {
    if (!selection) return none;
    return ['targets', 'viewports'].map((axis) => `${axis[0].toUpperCase()}${axis.slice(1)}: ${selection[axis] ? selection[axis].join(', ') : 'all'}`).join('. ');
};
const rows = computed(() => scope.value && [
    ['Compared targets', scope.value.targetIds.join(', ')],
    ['Compared viewports', scope.value.viewportIds.join(', ')],
    ['Baseline (A) selection', describe(scope.value.a, 'Full run, no selection')],
    ['Compared run (B) selection', describe(scope.value.b, 'Full run, no selection')],
    ['Filter of this comparison', describe(scope.value.filter, 'No filter')],
]);
</script>
<template>
    <component :is="collapsible ? 'details' : 'section'" v-if="scope" class="scope-details" aria-label="Scope of this comparison">
        <summary v-if="collapsible" class="scope-heading">Scope details</summary>
        <p v-else class="scope-heading">Scope</p>
        <dl class="scope-list">
            <div v-for="[term, text] in rows" :key="term"><dt>{{ term }}</dt><dd class="record">{{ text }}</dd></div>
        </dl>
    </component>
</template>
