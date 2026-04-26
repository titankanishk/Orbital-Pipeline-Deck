class PipelineEngine {
    constructor() {
        this.instructions = [];
        this.cycle_counter = 0;
        this.pipeline_model = 5;
        this.forwarding_enabled = false;
        this.hazard_log = [];
        this.history = []; 
        this.state = null;
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
        
        this.state = new Array(this.instructions.length).fill(0);
        if (this.instructions.length > 0) {
            this.history[0] = new Array(this.instructions.length).fill(null);
        }
    }

    writes_to(producer, consumer) {
        if (!producer.dest) return false;
        if (producer.dest === '$0' || producer.dest === '$ZERO' || producer.dest === 'R0') return false;
        return producer.dest === consumer.src1 || producer.dest === consumer.src2;
    }

    execute_cycle() {
        if (this.instructions.length === 0) return true;
        
        if (!this.state) {
            this.state = new Array(this.instructions.length).fill(0);
        }
        
        let N = this.instructions.length;
        let done_state = this.pipeline_model === 5 ? 6 : 5;
        
        let finished_all = true;
        for (let i = 0; i < N; i++) {
            if (this.state[i] !== done_state) finished_all = false;
        }
        if (finished_all) return true;

        let cycle = this.cycle_counter + 1;
        let new_state = [...this.state];
        let out = new Array(N).fill(null);

        for (let i = 0; i < N; i++) {
            if (this.state[i] === 0) {
                if (i === 0) {
                    new_state[i] = 2;
                    out[i] = 'IF';
                } 
                else {
                    // only fetch if previous instruction has left IF/ID safely
                    if (this.state[i-1] >= 2 && out[i-1] !== 'STALL') {
                        new_state[i] = 2;
                        out[i] = 'IF';
                    }
                }
            } else if (this.state[i] === 2) {
                let can_do = true;
                let hazard_log_msg = null;

                if (!this.forwarding_enabled) {
                    for (let j = 0; j < i; j++) {
                        if (this.writes_to(this.instructions[j], this.instructions[i])) {
                            if (this.state[j] < done_state) {
                                can_do = false;
                                hazard_log_msg = `[RAW HAZARD] Cycle ${cycle}: ${this.instructions[i].id} (${this.instructions[i].opcode}) requires ${this.instructions[j].dest}. Stalling ID stage to wait for ${this.instructions[j].id} (${this.instructions[j].opcode}) to finish.`;
                                break;
                            }
                        }
                    }
                } else {
                    if (this.pipeline_model === 5) {
                        for (let j = 0; j < i; j++) {
                            if (this.instructions[j].opcode === 'LW' && this.writes_to(this.instructions[j], this.instructions[i])) {
                                if (this.state[j] < 4) {
                                    can_do = false;
                                    hazard_log_msg = `[LOAD-USE HAZARD] Cycle ${cycle}: ${this.instructions[i].id} (${this.instructions[i].opcode}) requires ${this.instructions[j].dest} from memory. Stalling ID stage for ${this.instructions[j].id} (LW) data access.`;
                                    break;
                                }
                            }
                        }
                    }
                }

                if (can_do) {
                    if (i > 0 && this.state[i-1] === 3 && new_state[i-1] === 3) {
                        can_do = false;
                        hazard_log_msg = `[STRUCTURAL HAZARD] Cycle ${cycle}: ${this.instructions[i].id} (${this.instructions[i].opcode}) cannot advance. Stalling ID stage because ${this.instructions[i-1].id} (${this.instructions[i-1].opcode}) is stuck ahead.`;
                    }
                }

                if (can_do) {
                    new_state[i] = 3; 
                    out[i] = 'ID';
                } else {
                    out[i] = 'STALL';
                    if (hazard_log_msg && !this.hazard_log.includes(hazard_log_msg)) {
                        this.hazard_log.push(hazard_log_msg);
                    }
                }
            } else if (this.state[i] === 3) {
                let can_do = true;
                let hazard_log_msg = null;

                if (this.forwarding_enabled && this.pipeline_model === 4) {
                    for (let j = 0; j < i; j++) {
                        if (this.instructions[j].opcode === 'LW' && this.writes_to(this.instructions[j], this.instructions[i])) {
                            if (this.state[j] < 5) {
                                can_do = false;
                                hazard_log_msg = `[LOAD-USE HAZARD] Cycle ${cycle}: ${this.instructions[i].id} (${this.instructions[i].opcode}) requires ${this.instructions[j].dest} from memory. Stalling EX stage for ${this.instructions[j].id} (LW) data access.`;
                                break;
                            }
                        }
                    }
                }

                if (can_do) {
                    new_state[i] = 4;
                    out[i] = 'EX';
                } else {
                    out[i] = 'STALL';
                    if (hazard_log_msg && !this.hazard_log.includes(hazard_log_msg)) {
                        this.hazard_log.push(hazard_log_msg);
                    }
                }
            } else if (this.state[i] === 4) {
                new_state[i] = 5;
                out[i] = 'MEM';
            } else if (this.state[i] === 5) {
                if (this.pipeline_model === 5) {
                    new_state[i] = 6;
                    out[i] = 'WB';
                } else {
                    out[i] = 'RETIRED';
                }
            } else if (this.state[i] === 6 && this.pipeline_model === 5) {
                out[i] = 'RETIRED';
            }
        }
        
        this.state = new_state;
        this.history[cycle] = out;
        this.cycle_counter = cycle;
        
        finished_all = true;
        for (let i = 0; i < N; i++) {
            if (this.state[i] !== done_state) finished_all = false;
        }
        return finished_all;
    }

    run_all() {
        if (this.instructions.length === 0) return;
        let max_cycles = 50;
        while (this.cycle_counter < max_cycles) {
            let done = this.execute_cycle();
            if (done) break;
        }
    }
}
