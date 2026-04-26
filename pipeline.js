class PipelineEngine {
    constructor() {
        this.instructions = [];
        this.cycle_counter = 0;
        this.pipeline_model = 5;
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
            src2 = null; // parts[3] is immediate
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
        
        if (this.instructions.length > 0) {
            this.history[0] = new Array(this.instructions.length).fill(null);
        }
    }

    get_physical_stage(status) {
        if (!status) return null;
        if (['IF', 'ORBITAL_WAIT'].includes(status)) return 'IF';
        if (['ID', 'DATA_STALL', 'LOAD_STALL'].includes(status)) return 'ID';
        if (['EX', 'FWD_BYPASS'].includes(status)) return 'EX';
        if (status === 'MEM') return 'MEM';
        if (status === 'WB') return 'WB';
        if (status === 'MEM_WB') return 'MEM_WB';
        return null;
    }

    execute_cycle() {
        if (this.instructions.length === 0) return true;

        let next_states = new Array(this.instructions.length).fill(null);
        let current_cycle_states = this.history[this.cycle_counter];
        
        for (let i = 0; i < this.instructions.length; i++) {
            let inst = this.instructions[i];
            let current = current_cycle_states[i];
            
            if (current === null) {
                if (i === 0) {
                    next_states[i] = 'IF';
                } else {
                    let prev_next = next_states[i-1];
                    let prev_phys = this.get_physical_stage(prev_next);
                    if (prev_phys && prev_phys !== 'IF') {
                        next_states[i] = 'IF';
                    } else {
                        next_states[i] = null;
                    }
                }
            }
            else if (current === 'RETIRED') {
                next_states[i] = 'RETIRED';
            }
            else {
                let physical = this.get_physical_stage(current);
                
                if (physical === 'IF' || physical === 'ID') {
                    // ID acts as a gateway. If it is IF, ORBITAL_WAIT, DATA_STALL, or LOAD_STALL, it wants to successfully ID.
                    if (current === 'ID') {
                        // Successfully completed ID last cycle!
                        let uses_fwd = false;
                        if (this.forwarding_enabled) {
                            for (let j = 0; j < i; j++) {
                                let older = this.instructions[j];
                                if (older.dest && (inst.src1 === older.dest || inst.src2 === older.dest)) {
                                    let older_phys = this.get_physical_stage(next_states[j]);
                                    if (older_phys === 'MEM' || older_phys === 'WB' || older_phys === 'MEM_WB') {
                                        uses_fwd = true;
                                    }
                                }
                            }
                        }
                        next_states[i] = uses_fwd ? 'FWD_BYPASS' : 'EX';
                    } else {
                        // Wants to decode (either from IF, or currently stalled)
                        let can_attempt_decode = true;
                        
                        if (current === 'IF' || current === 'ORBITAL_WAIT') {
                            if (i > 0) {
                                let prev_next = next_states[i-1];
                                let prev_phys = this.get_physical_stage(prev_next);
                                if (prev_phys === 'ID') {
                                    can_attempt_decode = false; // Decode occupied
                                }
                            }
                        }
                        
                        if (!can_attempt_decode) {
                            next_states[i] = 'ORBITAL_WAIT';
                        } else {
                            let stall_reason = null;
                            let hazard_log_msg = null;
                            
                            let src1_producer = -1;
                            let src2_producer = -1;
                            for (let j = i - 1; j >= 0; j--) {
                                let older = this.instructions[j];
                                if (older.dest) {
                                    if (src1_producer === -1 && inst.src1 === older.dest) src1_producer = j;
                                    if (src2_producer === -1 && inst.src2 === older.dest) src2_producer = j;
                                }
                            }
                            
                            let producers = [];
                            if (src1_producer !== -1) producers.push(src1_producer);
                            if (src2_producer !== -1 && src2_producer !== src1_producer) producers.push(src2_producer);
                            
                            for (let j of producers) {
                                let older = this.instructions[j];
                                let older_next = next_states[j];
                                let older_phys = this.get_physical_stage(older_next);
                                
                                if (older_next === 'RETIRED') continue;
                                
                                if (this.forwarding_enabled) {
                                    if (older_phys === 'EX') {
                                        if (older.opcode === 'LW') {
                                            stall_reason = 'LOAD_STALL';
                                            hazard_log_msg = `[LOAD-USE HAZARD] Cycle ${this.cycle_counter + 1}: ${inst.id} requires ${older.dest}. LW data is fetched from memory and isn't available until the end of the MEM stage. Pipeline stalled.`;
                                        }
                                    }
                                    else if (older_phys === 'ID' || older_phys === 'IF') {
                                        stall_reason = 'DATA_STALL';
                                        hazard_log_msg = `[RAW HAZARD] Cycle ${this.cycle_counter + 1}: ${inst.id} requires ${older.dest}. Data is still being computed by an older instruction. Pipeline stalled.`;
                                    }
                                } else {
                                    if (older_phys === 'EX' || older_phys === 'ID' || older_phys === 'IF') {
                                        stall_reason = 'DATA_STALL';
                                        hazard_log_msg = `[RAW HAZARD] Cycle ${this.cycle_counter + 1}: ${inst.id} requires ${older.dest}. Without forwarding, dependent instructions must wait for older instructions to reach MEM/WB. Pipeline stalled.`;
                                    }
                                }
                                
                                if (stall_reason) break;
                            }
                            
                            if (stall_reason) {
                                next_states[i] = stall_reason;
                                if (hazard_log_msg && !this.hazard_log.includes(hazard_log_msg)) {
                                    this.hazard_log.push(hazard_log_msg);
                                }
                            } else {
                                next_states[i] = 'ID';
                            }
                        }
                    }
                }
                else if (physical === 'EX') {
                    next_states[i] = this.pipeline_model === 5 ? 'MEM' : 'MEM_WB';
                }
                else if (physical === 'MEM') {
                    next_states[i] = 'WB';
                }
                else if (physical === 'WB' || physical === 'MEM_WB') {
                    next_states[i] = 'RETIRED';
                }
            }
        }
        
        let really_all_retired = next_states.every(s => s === 'RETIRED');
        
        this.cycle_counter++;
        this.history[this.cycle_counter] = next_states;
        
        return really_all_retired;
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
