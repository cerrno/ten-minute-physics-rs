use glam::{vec3, Vec3};

use crate::mesh::{self, TetMeshData};

const GRAVITY: Vec3 = vec3(0.0, -10.0, 0.0);
const TIME_STEP: f32 = 1.0 / 60.0;
const VOL_ID_ORDER: [[usize; 3]; 4] = [[1, 3, 2], [0, 2, 3], [0, 3, 1], [0, 1, 2]];

pub struct SoftBody {
    pub num_particles: usize,
    pub num_tets: usize,
    num_substeps: usize,
    pub dt: f32,
    inv_dt: f32,

    pub tet_ids: Vec<[usize; 4]>,
    pub edge_ids: Vec<usize>,

    pub pos: Vec<Vec3>,
    prev: Vec<Vec3>,
    vel: Vec<Vec3>,
    inv_mass: Vec<f32>,
    rest_vol: Vec<f32>,
    edge_lens: Vec<f32>,

    grab_inv_mass: f32,
    grab_id: Option<usize>,

    pub edge_compliance: f32,
    pub vol_compliance: f32,

    // stored for reset
    mesh: TetMeshData,
}

impl SoftBody {
    pub fn new(num_substeps: usize, edge_compliance: f32, vol_compliance: f32) -> Self {
        let mesh = mesh::get_bunny();
        let num_particles = mesh.vertices.len();
        let num_tets = mesh.tet_ids.len();
        let num_edges = mesh.tet_edge_ids.len();
        let dt = TIME_STEP / num_substeps as f32;
        let mut body = Self {
            num_particles,
            num_tets,
            num_substeps: num_substeps,
            dt,
            inv_dt: 1.0 / dt,

            edge_ids: mesh.tet_edge_ids.clone(),
            tet_ids: mesh.tet_ids.clone(),

            pos: mesh.vertices.clone(),
            prev: mesh.vertices.clone(),
            vel: vec![Vec3::ZERO; num_particles],
            inv_mass: vec![0.0; num_particles],
            rest_vol: vec![0.0; num_tets],
            edge_lens: vec![0.0; num_edges / 2],

            grab_inv_mass: 0.0,
            grab_id: None,

            edge_compliance: edge_compliance,
            vol_compliance: vol_compliance,

            mesh,
        };
        body.init();
        body
    }

    pub fn surface_tri_ids(&self) -> Vec<usize> {
        self.mesh.tet_surface_tri_ids.clone()
    }

    pub fn set_solver_substeps(&mut self, num_substeps: usize) {
        self.num_substeps = num_substeps;
        self.dt = TIME_STEP / num_substeps as f32;
        self.inv_dt = 1.0 / self.dt;
    }

    fn init(&mut self) {
        for i in 0..self.num_tets {
            let vol = self.get_tet_volume(i);
            self.rest_vol[i] = vol;
            let inv_mass = if vol > 0.0 { 1.0 / (vol / 4.0) } else { 0.0 };
            let tet = self.tet_ids[i];
            self.inv_mass[tet[0]] += inv_mass;
            self.inv_mass[tet[1]] += inv_mass;
            self.inv_mass[tet[2]] += inv_mass;
            self.inv_mass[tet[3]] += inv_mass;
        }
        for i in 0..self.edge_lens.len() {
            let id0 = self.edge_ids[2 * i];
            let id1 = self.edge_ids[2 * i + 1];
            self.edge_lens[i] = self.pos[id0].distance(self.pos[id1]);
        }
    }

    fn pre_solve(&mut self) {
        for i in 0..self.num_particles {
            if self.inv_mass[i] == 0.0 {
                continue;
            }
            self.vel[i] += GRAVITY * self.dt;
            self.prev[i] = self.pos[i];
            self.pos[i] += self.vel[i] * self.dt;
            if self.pos[i].y < 0.0 {
                self.pos[i] = self.prev[i];
                self.pos[i].y = 0.0;
            }
        }
    }

    fn solve(&mut self) {
        self.solve_edges();
        self.solve_volumes();
    }

    fn post_solve(&mut self) {
        for i in 0..self.num_particles {
            if self.inv_mass[i] == 0.0 {
                continue;
            }
            self.vel[i] = (self.pos[i] - self.prev[i]) * self.inv_dt;
        }
    }

    fn solve_edges(&mut self) {
        let alpha = self.edge_compliance * self.inv_dt * self.inv_dt;
        for i in 0..self.edge_lens.len() {
            let id0 = self.edge_ids[2 * i];
            let id1 = self.edge_ids[2 * i + 1];
            let w0 = self.inv_mass[id0];
            let w1 = self.inv_mass[id1];
            let w = w0 + w1;
            if w == 0.0 {
                continue;
            }

            let mut temp = self.pos[id0] - self.pos[id1];
            let len = temp.length();
            if len == 0.0 {
                continue;
            }
            temp /= len;
            let rest_len = self.edge_lens[i];
            let c = len - rest_len;
            let s = -c / (w + alpha);
            self.pos[id0] += temp * s * w0;
            self.pos[id1] += temp * -s * w1;
        }
    }

    fn solve_volumes(&mut self) {
        let alpha = self.vol_compliance * self.inv_dt * self.inv_dt;
        for i in 0..self.num_tets {
            let mut w = 0.0;
            let tet = self.tet_ids[i];
            let mut grads = [Vec3::ZERO; 4];
            for j in 0..4 {
                let order = VOL_ID_ORDER[j];
                let id0 = tet[order[0]];
                let id1 = tet[order[1]];
                let id2 = tet[order[2]];

                let temp0 = self.pos[id1] - self.pos[id0];
                let temp1 = self.pos[id2] - self.pos[id0];
                grads[j] = temp0.cross(temp1) / 6.0;
                w += self.inv_mass[tet[j]] * grads[j].length_squared();
            }
            if w == 0.0 {
                continue;
            }
            let vol = self.get_tet_volume(i);
            let rest_vol = self.rest_vol[i];
            let c = vol - rest_vol;
            let s = -c / (w + alpha);
            for j in 0..4 {
                let id = self.tet_ids[i][j];
                self.pos[id] += grads[j] * s * self.inv_mass[id];
            }
        }
    }

    pub fn simulate(&mut self) {
        for _ in 0..self.num_substeps {
            self.pre_solve();
            self.solve();
            self.post_solve();
        }
    }

    fn get_tet_volume(&self, i: usize) -> f32 {
        let tet = self.tet_ids[i];
        let id0 = tet[0];
        let id1 = tet[1];
        let id2 = tet[2];
        let id3 = tet[3];
        let temp0 = self.pos[id1] - self.pos[id0];
        let temp1 = self.pos[id2] - self.pos[id0];
        let temp2 = self.pos[id3] - self.pos[id0];
        let temp3 = temp0.cross(temp1);
        temp3.dot(temp2) / 6.0
    }

    pub fn squash(&mut self) {
        for i in 0..self.num_particles {
            self.pos[i].y = 0.5;
        }
    }

    pub fn translate(&mut self, displacement: Vec3) {
        for i in 0..self.num_particles {
            self.pos[i] += displacement;
            self.prev[i] += displacement;
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
