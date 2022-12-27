use glam::{vec3, Vec3};
use rand::Rng;

use crate::hashing_11::Hash;

const GRAVITY: Vec3 = vec3(0.0, -10.0, 0.0);
pub const TIME_STEP: f32 = 1.0 / 60.0;
pub const DEFAULT_NUM_SOLVER_SUBSTEPS: usize = 10;
pub const DEFAULT_BENDING_COMPLIANCE: f32 = 1.0;
pub const DEFAULT_STRETCH_COMPLIANCE: f32 = 0.0;
pub const DEFAULT_SHEAR_COMPLIANCE: f32 = 0.0001;

const VEL_LIMIT_MULTIPLIER: f32 = 0.2;
const SPACING: f32 = 0.01;
const JITTER: f32 = 0.001 * SPACING;
const THICKNESS: f32 = 0.01;
const NUM_X: usize = 30;
const NUM_Y: usize = 200;
const NUM_CONSTRAINTS_PER_PARTICLE: usize = 6;

#[derive(Default, Clone, Copy)]
enum ConstraintKind {
    STRETCH,
    SHEAR,
    #[default]
    BENDING,
}

#[derive(Default, Clone, Copy)]
struct Constraint {
    ids: (usize, usize),
    kind: ConstraintKind,
    rest_len: f32,
}

pub struct Cloth {
    pub num_particles: usize,
    num_substeps: usize,
    pub dt: f32,
    inv_dt: f32,
    max_vel: f32,

    pub edge_ids: Vec<[usize; 2]>,
    pub tri_ids: Vec<[usize; 3]>,

    pub pos: Vec<Vec3>,
    prev: Vec<Vec3>,
    rest_pos: Vec<Vec3>,
    vel: Vec<Vec3>,
    inv_mass: Vec<f32>,
    thickness: f32,
    pub handle_collisions: bool,
    hash: Hash,

    grab_inv_mass: f32,
    grab_id: Option<usize>,

    num_constraints: usize,
    constraints: Vec<Constraint>,
    pub stretch_compliance: f32,
    pub shear_compliance: f32,
    pub bending_compliance: f32,

    grad: Vec3,
    grad1: Vec3,
    grad2: Vec3,
}

impl Cloth {
    pub fn new() -> Self {
        let num_particles = NUM_X * NUM_Y;

        let mut edge_ids = vec![];
        let mut tri_ids = vec![];
        for i in 0..NUM_X {
            for j in 0..NUM_Y {
                let id = i * NUM_Y + j;
                if i < NUM_X - 1 && j < NUM_Y - 1 {
                    tri_ids.push([id + 1, id, id + 1 + NUM_Y]);
                    tri_ids.push([id + 1 + NUM_Y, id, id + NUM_Y]);
                }
                if i < NUM_X - 1 {
                    edge_ids.push([id, id + NUM_Y]);
                }
                if j < NUM_Y - 1 {
                    edge_ids.push([id, id + 1]);
                }
            }
        }

        let dt = TIME_STEP / DEFAULT_NUM_SOLVER_SUBSTEPS as f32;
        let mut cloth = Self {
            num_particles,
            num_substeps: DEFAULT_NUM_SOLVER_SUBSTEPS,
            dt,
            inv_dt: 1.0 / dt,
            max_vel: VEL_LIMIT_MULTIPLIER * THICKNESS / dt,
            pos: vec![Vec3::ZERO; num_particles],
            prev: vec![Vec3::ZERO; num_particles],
            rest_pos: vec![Vec3::ZERO; num_particles],
            vel: vec![Vec3::ZERO; num_particles],
            inv_mass: vec![0.0; num_particles],
            thickness: THICKNESS,
            handle_collisions: true,
            hash: Hash::new(SPACING, num_particles),
            grab_id: None,
            grab_inv_mass: 0.0,
            constraints: vec![Constraint::default(); num_particles * NUM_CONSTRAINTS_PER_PARTICLE],
            stretch_compliance: DEFAULT_STRETCH_COMPLIANCE,
            shear_compliance: DEFAULT_SHEAR_COMPLIANCE,
            bending_compliance: DEFAULT_BENDING_COMPLIANCE,
            edge_ids,
            tri_ids,
            num_constraints: 0,
            grad: Vec3::ZERO,
            grad1: Vec3::ZERO,
            grad2: Vec3::ZERO,
        };
        cloth.init();
        cloth
    }

    pub fn reset(&mut self, attach: bool) {
        let mut rng = rand::thread_rng();
        for i in 0..NUM_X {
            for j in 0..NUM_Y {
                let id = i * NUM_Y + j;
                self.pos[id] = vec3(
                    -1.0 * NUM_X as f32 * SPACING * 0.5 + i as f32 * SPACING,
                    0.2 + j as f32 * SPACING,
                    0.0,
                );
                self.inv_mass[id] = 1.0;
                if attach && j == NUM_Y - 1 && (i == 0 || i == NUM_X - 1) {
                    self.inv_mass[id] = 0.0;
                }
            }
        }

        self.pos.iter_mut().for_each(|p| {
            p.x += -JITTER * 2.0 * JITTER * rng.gen::<f32>();
            p.y += -JITTER * 2.0 * JITTER * rng.gen::<f32>();
            p.z += -JITTER * 2.0 * JITTER * rng.gen::<f32>();
        });

        self.rest_pos.copy_from_slice(&self.pos);
        self.vel.fill(Vec3::ZERO);
    }

    pub fn set_solver_substeps(&mut self, num_substeps: usize) {
        self.num_substeps = num_substeps;
        self.dt = TIME_STEP / num_substeps as f32;
        self.inv_dt = 1.0 / self.dt;
        self.max_vel = VEL_LIMIT_MULTIPLIER * THICKNESS / self.dt;
    }

    fn init(&mut self) {
        self.reset(false);

        let constraints = [
            (ConstraintKind::STRETCH, (0, 0, 0, 1)),
            (ConstraintKind::STRETCH, (0, 0, 1, 0)),
            (ConstraintKind::SHEAR, (0, 0, 1, 1)),
            (ConstraintKind::SHEAR, (0, 1, 1, 0)),
            (ConstraintKind::BENDING, (0, 0, 0, 2)),
            (ConstraintKind::BENDING, (0, 0, 2, 0)),
        ];
        assert_eq!(constraints.len(), NUM_CONSTRAINTS_PER_PARTICLE);
        self.num_constraints = 0;
        for (kind, indices) in constraints {
            for i in 0..NUM_X {
                for j in 0..NUM_Y {
                    let i0 = i + indices.0;
                    let j0 = j + indices.1;
                    let i1 = i + indices.2;
                    let j1 = j + indices.3;
                    if i0 < NUM_X && j0 < NUM_Y && i1 < NUM_X && j1 < NUM_Y {
                        let id0 = i0 * NUM_Y + j0;
                        let id1 = i1 * NUM_Y + j1;
                        let rest_len = self.pos[id0].distance(self.pos[id1]);
                        self.constraints[self.num_constraints] = Constraint {
                            ids: (id0, id1),
                            kind,
                            rest_len,
                        };
                        self.num_constraints += 1;
                    }
                }
            }
        }
    }

    fn get_compliance(&self, constraint: &Constraint) -> f32 {
        match constraint.kind {
            ConstraintKind::STRETCH => self.stretch_compliance,
            ConstraintKind::SHEAR => self.shear_compliance,
            ConstraintKind::BENDING => self.bending_compliance,
        }
    }

    pub fn simulate(&mut self) {
        if self.handle_collisions {
            self.hash.create(&self.pos);
            let max_dist = self.max_vel * self.dt * self.num_substeps as f32;
            self.hash.query_all(&self.pos, max_dist);
        }

        for _ in 0..self.num_substeps {
            // integrate
            for i in 0..self.num_particles {
                if self.inv_mass[i] == 0.0 {
                    continue;
                }
                self.vel[i] += GRAVITY * self.dt;
                let v = self.vel[i].length();
                if v > self.max_vel {
                    self.vel[i] *= self.max_vel / v;
                }
                self.prev[i] = self.pos[i];
                self.pos[i] += self.vel[i] * self.dt;
            }

            // solve
            self.solve_ground_collisions();
            self.solve_constraints();
            if self.handle_collisions {
                self.solve_collisions();
            }

            // update velocities
            for i in 0..self.num_particles {
                if self.inv_mass[i] == 0.0 {
                    continue;
                }
                self.vel[i] = (self.pos[i] - self.prev[i]) * self.inv_dt;
            }
        }
    }

    fn solve_constraints(&mut self) {
        for cons in &self.constraints {
            let id0 = cons.ids.0;
            let id1 = cons.ids.1;
            let w0 = self.inv_mass[id0];
            let w1 = self.inv_mass[id1];
            let w = w0 + w1;
            if w == 0.0 {
                continue;
            }

            self.grad = self.pos[id0] - self.pos[id1];
            let len = self.grad.length();
            if len == 0.0 {
                continue;
            }
            self.grad /= len;
            let c = len - cons.rest_len;
            let alpha = self.get_compliance(cons) * self.inv_dt * self.inv_dt;
            let s = -c / (w + alpha);
            self.pos[id0] += self.grad * s * w0;
            self.pos[id1] += self.grad * -s * w1;
        }
    }

    fn solve_ground_collisions(&mut self) {
        for i in 0..self.num_particles {
            if self.inv_mass[i] == 0.0 {
                continue;
            }
            if self.pos[i].y < 0.5 * self.thickness {
                let damping = 1.0;
                self.grad = self.pos[i] - self.prev[i];
                self.pos[i] += self.grad * -damping;
                self.pos[i].y = 0.5 * self.thickness;
            }
        }
    }

    fn solve_collisions(&mut self) {
        let thickness_sq = self.thickness * self.thickness;
        for i in 0..self.num_particles {
            if self.inv_mass[i] == 0.0 {
                continue;
            }
            let id0 = i;
            let first = self.hash.first_adj_id[i];
            let last = self.hash.first_adj_id[i + 1];
            for j in first..last {
                let id1 = self.hash.adj_ids[j];
                if self.inv_mass[id1] == 0.0 {
                    continue;
                }
                self.grad = self.pos[id1] - self.pos[id0];
                let dist_sq = self.grad.length_squared();
                if dist_sq > thickness_sq || dist_sq == 0.0 {
                    continue;
                }
                let rest_dist_sq = (self.rest_pos[id0] - self.rest_pos[id1]).length();
                let mut min_dist = self.thickness;
                if dist_sq > rest_dist_sq {
                    continue;
                }
                if rest_dist_sq < thickness_sq {
                    min_dist = rest_dist_sq.sqrt();
                }

                // position correction
                let dist = dist_sq.sqrt();
                self.grad *= (min_dist - dist) / dist;
                self.pos[id0] += self.grad * -0.5;
                self.pos[id1] += self.grad * 0.5;

                // velocities
                self.grad = self.pos[id0] - self.prev[id0];
                self.grad1 = self.pos[id1] - self.prev[id1];

                // average velocity
                self.grad2 = (self.grad + self.grad1) * 0.5;

                // velocity correction
                self.grad = self.grad2 - self.grad;
                self.grad1 = self.grad2 - self.grad1;

                // add corrections
                let friction = 0.0;
                self.pos[id0] += self.grad * friction;
                self.pos[id1] += self.grad1 * friction;
            }
        }
    }

    pub fn start_grab(&mut self, pos: &Vec3) {
        let mut min_d2 = f32::MAX;
        self.grab_id = None;
        for i in 0..self.num_particles {
            let d2 = (*pos - self.pos[i]).length_squared();
            if d2 < min_d2 {
                min_d2 = d2;
                self.grab_id = Some(i);
            }
        }

        if let Some(i) = self.grab_id {
            self.grab_inv_mass = self.inv_mass[i];
            self.inv_mass[i] = 0.0;
            self.pos[i] = *pos;
        }
    }

    pub fn move_grabbed(&mut self, pos: &Vec3) {
        if let Some(i) = self.grab_id {
            self.pos[i] = *pos;
        }
    }

    pub fn end_grab(&mut self, vel: &Vec3) {
        if let Some(i) = self.grab_id {
            self.inv_mass[i] = self.grab_inv_mass;
            self.vel[i] = *vel;
        }
        self.grab_id = None;
    }
}