import { PostItemComponent } from './components/post-item/post-item.component';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

@NgModule({
  imports: [
    CommonModule
  ],
  declarations: [PostItemComponent],
  exports:[PostItemComponent]
})
export class SharedModule { }
