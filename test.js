const fs = require('fs');
const content = fs.readFileSync('pipeline.js', 'utf8');
eval(content);

function runTest(testName, program, model) {
    console.log(`\n=== ${testName} ===`);
    let p = new PipelineEngine();
    
    p.load_program(program, model, false);
    p.run_all();
    console.log('Without Forwarding');
    console.log('Cycle ' + Array.from({length: p.cycle_counter}, (_,i)=>i+1).join(' '));
    p.instructions.forEach((inst, i) => {
        let stages = p.history.map(h => h[i] ? h[i] : '  ').filter((_, cycle) => cycle > 0);
        console.log(inst.id + ' ' + stages.join(' '));
    });

    p.load_program(program, model, true);
    p.run_all();
    console.log('With Forwarding');
    console.log('Cycle ' + Array.from({length: p.cycle_counter}, (_,i)=>i+1).join(' '));
    p.instructions.forEach((inst, i) => {
        let stages = p.history.map(h => h[i] ? h[i] : '  ').filter((_, cycle) => cycle > 0);
        console.log(inst.id + ' ' + stages.join(' '));
    });
}

runTest("Test Case 1", "add $t0, $t1, $t2\nsub $t3, $t0, $t4", 4);
runTest("Test Case 2", "add $t0, $t1, $t2\nand $t5, $t6, $t7\nsub $t3, $t0, $t4", 4);
runTest("Test Case 3", "lw $t0, 0($t1)\nadd $t2, $t0, $t3", 4);
runTest("Test Case 4", "lw $t0, 0($t1)\nori $t5, $t6, 7\nadd $t2, $t0, $t3", 4);
runTest("Test Case 5", "add $t0, $t1, $t2\nadd $t0, $t0, $t3\nsub $t4, $t0, $t5", 4);
runTest("Test Case 6", "add $t0, $t1, $t2\nsw $t0, 0($t3)", 4);
