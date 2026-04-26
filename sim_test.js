class PipelineEngine {
    constructor() {
        this.instructions = [];
        this.cycle_counter = 0;
        this.pipeline_model = 4;
        this.forwarding_enabled = false;
        this.hazard_log = [];
        this.history = []; 
    }

    parse_instruction(raw_text) {
        let normalized = raw_text.toUpperCase().replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
        let parts = normalized.split(' ');
        let opcode = parts[0];
        let dest = null, src1 = null, src2 = null;
        
        if (['ADD', 'SUB', 'AND', 'OR', 'XOR', 'MUL'].includes(opcode)) {
            dest = parts[1];
            src1 = parts[2];
            src2 = parts[3];
        } else if (['ADDI', 'SUBI', 'ANDI', 'ORI', 'XORI'].includes(opcode)) {
            dest = parts[1];
            src1 = parts[2];
            src2 = null;
        } else if (opcode === 'LW') {
            dest = parts[1];
            src1 = parts[3] ? parts[3] : parts[2];
        } else if (opcode === 'SW') {
            src1 = parts[1];
            src2 = parts[3] ? parts[3] : parts[2];
        }
        return { opcode, dest, src1, src2, raw_text };
    }

    load_program(text, model, forwarding) {
        this.pipeline_model = parseInt(model);
        this.forwarding_enabled = (forwarding === 'true' || forwarding === true);
        this.cycle_counter = 0;
        this.hazard_log = [];
        this.history = [];
        
        let lines = text.split('\n').map(l => l.trim()).filter(l => l);
        this.instructions = lines.slice(0, 10).map((l, i) => {
            let inst = this.parse_instruction(l);
            inst.id = `I${i+1}`;
            return inst;
        });
    }

    writes_to(producer, consumer) {
        if (!producer.dest) return false;
        if (producer.dest === '$0' || producer.dest === '$ZERO') return false;
        return producer.dest === consumer.src1 || producer.dest === consumer.src2;
    }

    run_all() {
        if (this.instructions.length === 0) return;
        let N = this.instructions.length;
        let state = new Array(N).fill(0);
        let done_state = this.pipeline_model === 5 ? 6 : 5;
        this.history = []; // 1-indexed

        for (let cycle = 1; cycle <= 50; cycle++) {
            let finished_all = true;
            for (let i = 0; i < N; i++) {
                if (state[i] !== done_state) finished_all = false;
            }
            if (finished_all) break;

            let new_state = [...state];
            let out = new Array(N).fill('');

            for (let i = 0; i < N; i++) {
                if (state[i] === 0) {
                    if (cycle === i + 1) {
                        new_state[i] = 2; // Needs ID
                        out[i] = 'IF';
                    }
                } else if (state[i] === 2) {
                    let can_do = true;
                    if (i > 0 && state[i-1] < 3) can_do = false;

                    if (can_do && !this.forwarding_enabled) {
                        for (let j = 0; j < i; j++) {
                            if (this.writes_to(this.instructions[j], this.instructions[i])) {
                                if (state[j] < done_state) {
                                    can_do = false;
                                    break;
                                }
                            }
                        }
                    }

                    if (can_do) {
                        new_state[i] = 3; 
                        out[i] = 'ID';
                    } else {
                        out[i] = 'ST';
                    }
                } else if (state[i] === 3) {
                    let can_do = true;
                    if (i > 0 && state[i-1] < 4) can_do = false;

                    if (can_do && this.forwarding_enabled) {
                        for (let j = 0; j < i; j++) {
                            if (this.instructions[j].opcode === 'LW' && this.writes_to(this.instructions[j], this.instructions[i])) {
                                if (state[j] < 5) {
                                    can_do = false;
                                    break;
                                }
                            }
                        }
                    }

                    if (can_do) {
                        new_state[i] = 4;
                        out[i] = 'EX';
                    } else {
                        out[i] = 'ST';
                    }
                } else if (state[i] === 4) {
                    let can_do = true;
                    if (i > 0 && state[i-1] < 5) can_do = false;

                    if (can_do) {
                        new_state[i] = 5;
                        out[i] = 'MEM';
                    } else {
                        out[i] = 'ST';
                    }
                } else if (state[i] === 5 && this.pipeline_model === 5) {
                    let can_do = true;
                    if (i > 0 && state[i-1] < 6) can_do = false;

                    if (can_do) {
                        new_state[i] = 6;
                        out[i] = 'WB';
                    } else {
                        out[i] = 'ST';
                    }
                }
            }
            state = new_state;
            this.history[cycle] = out;
            this.cycle_counter = cycle;
        }
    }
}

function runTest(testName, program, model) {
    console.log(`\n=== ${testName} ===`);
    let p = new PipelineEngine();
    
    p.load_program(program, model, false);
    p.run_all();
    console.log('Without Forwarding');
    p.instructions.forEach((inst, i) => {
        let stages = p.history.map(h => h[i] ? h[i] : '  ').filter((_, cycle) => cycle > 0);
        console.log(inst.id + ' ' + stages.join(' ').trim());
    });

    p.load_program(program, model, true);
    p.run_all();
    console.log('With Forwarding');
    p.instructions.forEach((inst, i) => {
        let stages = p.history.map(h => h[i] ? h[i] : '  ').filter((_, cycle) => cycle > 0);
        console.log(inst.id + ' ' + stages.join(' ').trim());
    });
}

runTest("Test Case 1", "add $t0, $t1, $t2\nsub $t3, $t0, $t4", 4);
runTest("Test Case 2", "add $t0, $t1, $t2\nand $t5, $t6, $t7\nsub $t3, $t0, $t4", 4);
runTest("Test Case 3", "lw $t0, 0($t1)\nadd $t2, $t0, $t3", 4);
runTest("Test Case 4", "lw $t0, 0($t1)\nori $t5, $t6, 7\nadd $t2, $t0, $t3", 4);
runTest("Test Case 5", "add $t0, $t1, $t2\nadd $t0, $t0, $t3\nsub $t4, $t0, $t5", 4);
runTest("Test Case 6", "add $t0, $t1, $t2\nsw $t0, 0($t3)", 4);
